use luft_listen_together::QueueEdit;
use tauri::State;

use crate::{error::CommandError, listen_together::ListenTogetherStatus, state::AppState};

#[path = "room_selection.rs"]
mod selection;
pub(crate) use selection::{enqueue_in_room, select_in_room};

#[tauri::command]
pub async fn listen_together_save_profile(
    name: String,
    avatar_uri: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let name = name.trim().to_owned();
    if name.is_empty()
        || name.chars().count() > 32
        || name.chars().any(char::is_control)
        || !luft_listen_together::valid_avatar(avatar_uri.as_deref())
    {
        return Err(CommandError::internal("listen.profileInvalid"));
    }
    let database = state
        .database
        .get()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;
    let mut settings = database
        .settings()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;
    settings.listen_together.display_name = name.clone();
    settings.listen_together.avatar_uri = avatar_uri.clone();
    database
        .save_settings(&settings)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;
    state.listen_together.set_profile(name, avatar_uri).await;
    Ok(())
}

pub(crate) async fn load_profile(state: &AppState) -> Result<(), CommandError> {
    let database = state
        .database
        .get()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;
    let profile = database
        .settings()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?
        .listen_together;
    if !profile.display_name.is_empty() {
        state
            .listen_together
            .set_profile(profile.display_name, profile.avatar_uri)
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn listen_together_queue_edit(
    room_id: String,
    edit: QueueEdit,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    state
        .listen_together
        .edit_queue(room_id, edit)
        .await
        .map_err(CommandError::internal)
}

pub(crate) async fn require_local_playback(state: &AppState) -> Result<(), CommandError> {
    if state.listen_together.status().await.room_id.is_some() {
        return Err(CommandError::internal("listen.queueOnly"));
    }
    Ok(())
}

#[tauri::command]
pub async fn listen_together_status(
    state: State<'_, AppState>,
) -> Result<ListenTogetherStatus, CommandError> {
    Ok(state.listen_together.status().await)
}

#[tauri::command]
pub async fn listen_together_create_room(
    state: State<'_, AppState>,
) -> Result<ListenTogetherStatus, CommandError> {
    load_profile(&state).await?;
    // A room replaces listening along; both would steer the same player.
    state.friends.stop_listen_along(None).await;
    let status = state
        .listen_together
        .create_room()
        .await
        .map_err(CommandError::internal)?;
    state.friends.announce_room();
    Ok(status)
}

#[tauri::command]
pub async fn listen_together_join_room(
    code: String,
    state: State<'_, AppState>,
) -> Result<ListenTogetherStatus, CommandError> {
    load_profile(&state).await?;
    state.friends.stop_listen_along(None).await;
    let status = state
        .listen_together
        .join_room(code)
        .await
        .map_err(CommandError::internal)?;
    state.friends.announce_room();
    Ok(status)
}

#[tauri::command]
pub async fn listen_together_leave(
    state: State<'_, AppState>,
) -> Result<ListenTogetherStatus, CommandError> {
    state
        .listen_together
        .leave()
        .await
        .map_err(CommandError::internal)
}

#[tauri::command]
pub async fn listen_together_control(
    action: luft_listen_together::RoomControl,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    state
        .listen_together
        .control(action)
        .await
        .map_err(CommandError::internal)
}

#[tauri::command]
pub async fn listen_together_set_control(
    mode: luft_listen_together::ControlMode,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    state
        .listen_together
        .set_control(mode)
        .await
        .map_err(CommandError::internal)
}

#[tauri::command]
pub async fn listen_together_set_queue_policy(
    policy: luft_listen_together::QueuePolicy,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    state
        .listen_together
        .set_queue_policy(policy)
        .await
        .map_err(CommandError::internal)
}

/// Whether a sync server answers at `url` (or the saved address), and with
/// which protocol, before anyone opens a room there.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCheck {
    reachable: bool,
    compatible: bool,
    protocol: Option<u16>,
    latency_ms: Option<u64>,
    error: Option<String>,
}

#[tauri::command]
pub async fn listen_together_check_server(
    url: Option<String>,
    state: State<'_, AppState>,
) -> Result<ServerCheck, CommandError> {
    let url = match url {
        Some(url) => url,
        None => state.listen_together.status().await.server_url,
    };
    Ok(check_server(&url).await)
}

async fn check_server(url: &str) -> ServerCheck {
    let unreachable = |error: &str| ServerCheck {
        reachable: false,
        compatible: false,
        protocol: None,
        latency_ms: None,
        error: Some(error.to_owned()),
    };
    let Some(health) = health_url(url) else {
        return unreachable("listen.invalidUrl");
    };
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
    else {
        return unreachable("listen.error.unreachable");
    };
    let started = std::time::Instant::now();
    let response = match client.get(health).send().await {
        Ok(response) => response,
        Err(_) => return unreachable("listen.error.unreachable"),
    };
    let latency_ms = Some(started.elapsed().as_millis() as u64);
    if !response.status().is_success() {
        // Railway answers 404 "Application not found" for a removed service.
        return unreachable(if response.status() == reqwest::StatusCode::NOT_FOUND {
            "listen.error.serverMissing"
        } else {
            "listen.error.unreachable"
        });
    }
    let body = response.text().await.unwrap_or_default();
    let protocol = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| value.get("protocol").and_then(serde_json::Value::as_u64))
        .and_then(|protocol| u16::try_from(protocol).ok());
    let compatible = protocol == Some(luft_listen_together::PROTOCOL_VERSION);
    ServerCheck {
        reachable: true,
        compatible,
        protocol,
        latency_ms,
        error: (!compatible).then(|| "listen.protocolMismatch".to_owned()),
    }
}

/// `wss://host/ws` → `https://host/health`.
fn health_url(url: &str) -> Option<String> {
    let mut parsed = url::Url::parse(url.trim()).ok()?;
    let scheme = match parsed.scheme() {
        "ws" => "http",
        "wss" => "https",
        _ => return None,
    };
    parsed.set_scheme(scheme).ok()?;
    parsed.set_path("/health");
    parsed.set_query(None);
    Some(parsed.to_string())
}

#[cfg(test)]
mod tests {
    use super::health_url;

    #[test]
    fn health_lives_next_to_the_socket() {
        assert_eq!(
            health_url("wss://luft.example.app/ws").as_deref(),
            Some("https://luft.example.app/health")
        );
        assert_eq!(
            health_url("ws://127.0.0.1:7421").as_deref(),
            Some("http://127.0.0.1:7421/health")
        );
        assert_eq!(health_url("https://luft.example.app"), None);
    }
}
