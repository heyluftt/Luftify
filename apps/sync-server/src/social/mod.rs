mod achievements;
mod actions;
mod admin;
mod admin_tools;
mod auto_backup;
mod activity;
mod badges;
mod chat;
mod db;
mod device_presence;
mod devices;
mod error;
mod listen_along;
mod media;
mod playlist_shares;
mod profiles;
mod rate;
mod recovery;
mod remote;
mod relations;
mod reports;
mod roles;
mod snapshot;
#[cfg(test)]
mod tests;

use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{ConnectInfo, DefaultBodyLimit, Path, Query, Request, State},
    body::Bytes,
    http::{HeaderMap, HeaderValue, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use luft_listen_together::{ProblemReport, ProblemReportInput, ProblemReportSummary};
use luft_listen_together::media::{MediaKind, MediaUpload};
use luft_listen_together::social::ListenAlongState;
use luft_listen_together::admin::AdminOverview;
use luft_listen_together::recovery::RecoveryCode;
use luft_listen_together::devices::{DeviceLink, DeviceRedeem, LinkedDevice};
use luft_listen_together::social::{
    PresenceUpdate, SocialAction, SocialProfile, SocialProfileInput, SocialRegistration,
    SocialSnapshot,
};
use serde::Deserialize;

use crate::hub::SharedHub;
pub use db::Store;
pub use error::{ApiError, ApiResult};

struct SocialState {
    store: Store,
    hub: SharedHub,
    rate: rate::RateBudgets,
    remote: remote::RemoteHub,
}
type SharedState = Arc<SocialState>;

pub async fn router(hub: SharedHub) -> Result<Router, sqlx::Error> {
    let path = std::env::var_os("LUFTIFY_SOCIAL_DATABASE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("data/social.sqlite"));
    let state = Arc::new(SocialState {
        store: Store::open(&path).await?,
        hub,
        rate: rate::RateBudgets::default(),
        remote: remote::RemoteHub::default(),
    });
    if let Some(code) = std::env::var("LUFTIFY_OWNER_CODE").ok().filter(|v| !v.trim().is_empty()) {
        match state.store.grant_owner(&code).await {
            Ok(true) => tracing::info!("owner role confirmed"),
            Ok(false) => tracing::warn!("LUFTIFY_OWNER_CODE matches no profile"),
            Err(_) => tracing::warn!("owner role unavailable"),
        }
    }
    auto_backup::keep_backing_up(state.clone());
    let cleanup = state.clone();
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(60));
        loop {
            timer.tick().await;
            if cleanup.store.cleanup().await.is_err() {
                tracing::warn!("social database cleanup unavailable");
            }
        }
    });
    Ok(routes(state))
}

fn routes(state: SharedState) -> Router {
    Router::new()
        .route("/social/v1/register", post(register))
        .route("/social/v1/me", get(me))
        .route("/social/v1/search", get(search))
        .route("/social/v1/chats", get(chat::inbox).layer(middleware::from_fn(chat::private_response)))
        .route("/social/v1/chats/{id}", get(chat::messages).post(chat::send).layer(middleware::from_fn(chat::private_response)))
        .route("/social/v1/chats/{id}/read", post(chat::read).layer(middleware::from_fn(chat::private_response)))
        .route("/social/v1/action", post(action))
        .route("/social/v1/presence", post(presence))
        .route("/social/v1/reports", post(submit_report).get(reports))
        .route("/social/v1/reports/{id}", get(report).delete(delete_report))
        .route("/social/v1/media", post(upload_media).layer(DefaultBodyLimit::max(MediaKind::Banner.max_bytes() + 1024)))
        .route("/social/v1/media/{id}", get(media))
        .route("/social/v1/listen-along/{id}", get(listen_along).delete(stop_listening_along))
        .route("/social/v1/admin/users", get(admin_users))
        .route("/social/v1/admin/backup", get(admin_backup))
        .route("/social/v1/recovery", post(new_recovery_code))
        .route("/social/v1/restore", post(restore))
        .route("/social/v1/devices", get(devices))
        .route("/social/v1/devices/link", post(link_device))
        .route("/social/v1/devices/redeem", post(redeem_device))
        .route("/social/v1/devices/{id}", delete(remove_device))
        .route("/social/v1/remote", get(remote::upgrade))
        .layer(DefaultBodyLimit::max(
            luft_listen_together::MAX_MESSAGE_BYTES,
        ))
        .layer(middleware::from_fn_with_state(state.clone(), rate_limit))
        .with_state(state)
}

async fn rate_limit(State(state): State<SharedState>, request: Request, next: Next) -> Response {
    let address = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|v| v.0.ip());
    let kind = match request.uri().path() {
        "/social/v1/register" => rate::Budget::Registration,
        "/social/v1/restore" | "/social/v1/devices/redeem" => rate::Budget::Restore,
        _ => rate::Budget::Request,
    };
    if let Some(address) = address {
        if !state.rate.allow(address, kind).await {
            return ApiError::limited().into_response();
        }
    }
    next.run(request).await
}

async fn register(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(input): Json<SocialProfileInput>,
) -> ApiResult<Json<SocialRegistration>> {
    let key = headers
        .get("x-luftify-registration-key")
        .map(|v| v.to_str().map_err(|_| ApiError::bad("invalidProfile")))
        .transpose()?;
    Ok(Json(state.store.register_with_key(input, key).await?))
}

async fn new_recovery_code(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> ApiResult<Json<RecoveryCode>> {
    let id = state.store.authenticate(&headers).await?;
    Ok(Json(RecoveryCode { code: state.store.new_recovery_code(&id).await? }))
}

/// Unauthenticated by design: the code is the proof. Strictly rate limited.
async fn restore(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(input): Json<RecoveryCode>,
) -> ApiResult<Json<SocialRegistration>> {
    let key = headers.get("x-luftify-registration-key").and_then(|v| v.to_str().ok());
    let registration = state.store.restore(&input.code, key).await?;
    let snapshot = with_overview(&state, registration.snapshot).await?;
    Ok(Json(SocialRegistration { token: registration.token, snapshot }))
}

async fn devices(State(state): State<SharedState>, headers: HeaderMap) -> ApiResult<Json<Vec<LinkedDevice>>> {
    let (id, device) = state.store.authenticate_device(&headers).await?;
    Ok(Json(state.store.devices(&id, &device).await?))
}

async fn link_device(State(state): State<SharedState>, headers: HeaderMap) -> ApiResult<Json<DeviceLink>> {
    let id = state.store.authenticate(&headers).await?;
    Ok(Json(state.store.new_link_code(&id).await?))
}

/// Unauthenticated by design: the link code is the proof. Rate limited like restore.
async fn redeem_device(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(input): Json<DeviceRedeem>,
) -> ApiResult<Json<SocialRegistration>> {
    let key = headers.get("x-luftify-registration-key").and_then(|v| v.to_str().ok());
    let registration = state.store.redeem_link_code(&input.code, &input.label, key).await?;
    let snapshot = with_overview(&state, registration.snapshot).await?;
    Ok(Json(SocialRegistration { token: registration.token, snapshot }))
}

async fn remove_device(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(device): Path<String>,
) -> ApiResult<Json<Vec<LinkedDevice>>> {
    let (id, current) = state.store.authenticate_device(&headers).await?;
    state.store.remove_device(&id, &device).await?;
    state.remote.drop_device(&id, &device.to_ascii_lowercase()).await;
    Ok(Json(state.store.devices(&id, &current).await?))
}

async fn me(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> ApiResult<Json<SocialSnapshot>> {
    let id = state.store.authenticate(&headers).await?;
    let snapshot = state.store.snapshot(&id).await?;
    Ok(Json(with_overview(&state, snapshot).await?))
}

/// Luft and developers also receive the server overview.
async fn with_overview(state: &SocialState, mut snapshot: SocialSnapshot) -> ApiResult<SocialSnapshot> {
    if snapshot.me.roles.iter().any(|role| role.sees_server()) {
        let mut overview = state.store.overview().await?;
        overview.rooms = state.hub.room_count().await as u32;
        snapshot.server = Some(overview);
    }
    Ok(snapshot)
}

#[derive(Deserialize)]
struct Search {
    q: String,
}

async fn search(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<Search>,
) -> ApiResult<Json<Vec<SocialProfile>>> {
    let id = state.store.authenticate(&headers).await?;
    Ok(Json(state.store.search(&id, &query.q).await?))
}

async fn action(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(action): Json<SocialAction>,
) -> ApiResult<Json<SocialSnapshot>> {
    let id = state.store.authenticate(&headers).await?;
    if let SocialAction::Invite {
        join_code,
        room_token,
        ..
    } = &action
    {
        if room_token.len() > 64 || !state.hub.valid_invitation(join_code, room_token).await {
            return Err(ApiError::denied("roomUnavailable"));
        }
    }
    let snapshot = state.store.action(&id, action).await?;
    Ok(Json(with_overview(&state, snapshot).await?))
}

async fn presence(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(update): Json<PresenceUpdate>,
) -> ApiResult<Json<SocialSnapshot>> {
    let (id, device) = state.store.authenticate_device(&headers).await?;
    let room = update.room.clone().filter(|proof| proof.room_token.len() <= 64);
    let snapshot = state.store.update_presence_from(&id, &device, update).await?;
    if let Some(proof) = room {
        // Only the member holding this private token can show roles in its room.
        // The room shows what the profile chose to show.
        let (roles, badges) = match &snapshot.me.style {
            Some(style) => style.visible_badges(&snapshot.me.roles, &snapshot.me.badges),
            None => (snapshot.me.roles.clone(), snapshot.me.badges.clone()),
        };
        state.hub.link_roles(&proof.join_code, &proof.room_token, &roles, &badges).await;
        // In a room with someone else: the "together" achievement.
        if state.hub.connected_members(&proof.join_code, &proof.room_token).await.is_some_and(|members| members >= 2) {
            state.store.unlock(&id, "together").await?;
        }
    }
    Ok(Json(with_overview(&state, snapshot).await?))
}

async fn submit_report(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(input): Json<ProblemReportInput>,
) -> ApiResult<Json<ProblemReportSummary>> {
    let id = state.store.authenticate(&headers).await?;
    Ok(Json(state.store.submit_report(&id, input).await?))
}

async fn reports(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<ProblemReportSummary>>> {
    let id = state.store.authenticate(&headers).await?;
    Ok(Json(state.store.reports(&id).await?))
}

async fn report(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(report): Path<String>,
) -> ApiResult<Json<ProblemReport>> {
    let id = state.store.authenticate(&headers).await?;
    Ok(Json(state.store.report(&id, &report).await?))
}

async fn delete_report(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(report): Path<String>,
) -> ApiResult<Json<()>> {
    let id = state.store.authenticate(&headers).await?;
    Ok(Json(state.store.delete_report(&id, &report).await?))
}

#[derive(Deserialize)]
struct MediaQuery {
    kind: String,
}

async fn upload_media(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<MediaQuery>,
    body: Bytes,
) -> ApiResult<Json<MediaUpload>> {
    let id = state.store.authenticate(&headers).await?;
    let kind = MediaKind::from_key(&query.kind).ok_or_else(|| ApiError::bad("invalidMedia"))?;
    Ok(Json(state.store.upload_media(&id, kind, &body).await?))
}

async fn media(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(media): Path<String>,
) -> ApiResult<Response> {
    state.store.authenticate(&headers).await?;
    let (bytes, content_type) = state.store.media(&media).await?;
    let mut response = bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    // Ids name their content, so a file never changes.
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
    Ok(response)
}

async fn listen_along(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(friend): Path<String>,
) -> ApiResult<Json<ListenAlongState>> {
    let id = state.store.authenticate(&headers).await?;
    Ok(Json(state.store.listen_along(&id, &friend).await?))
}

async fn stop_listening_along(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(friend): Path<String>,
) -> ApiResult<Json<()>> {
    let id = state.store.authenticate(&headers).await?;
    state.store.stop_listening_along(&id, &friend).await;
    Ok(Json(()))
}

/// Luft only: every profile with session, version, friends and media.
async fn admin_users(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> ApiResult<Json<AdminOverview>> {
    let id = state.store.authenticate(&headers).await?;
    let mut overview = state.store.admin_overview(&id).await?;
    overview.rooms = state.hub.room_count().await as u32;
    overview.server.room_members = state.hub.connected_member_count().await as u32;
    Ok(Json(overview))
}

/// Luft only: the whole database as one SQLite file.
async fn admin_backup(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let id = state.store.authenticate(&headers).await?;
    let bytes = state.store.backup(&id).await?;
    let mut response = bytes.into_response();
    response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/vnd.sqlite3"));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
