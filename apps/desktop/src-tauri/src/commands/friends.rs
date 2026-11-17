use luft_listen_together::{SocialAction, SocialProfile, SocialProfileInput, media::MediaKind};
use tauri::State;
use tokio::sync::Mutex;

use crate::{error::CommandError, friends::FriendsStatus, state::AppState};

// A double click must not create multiple rooms or replace a pending invitation join.
static ROOM_ACTION: Mutex<()> = Mutex::const_new(());

#[tauri::command]
pub async fn friends_status(state: State<'_, AppState>) -> Result<FriendsStatus, CommandError> {
    Ok(state.friends.status())
}

#[tauri::command]
pub async fn friends_refresh(state: State<'_, AppState>) -> Result<FriendsStatus, CommandError> {
    Ok(state.friends.refresh_now().await)
}

#[tauri::command]
pub async fn friends_activate(
    mut profile: SocialProfileInput,
    state: State<'_, AppState>,
) -> Result<FriendsStatus, CommandError> {
    if !profile.validate() {
        return Err(CommandError::internal("friends.error.invalidProfile"));
    }
    save_profile(&state, profile.clone()).await?;
    state
        .friends
        .activate(profile)
        .await
        .map_err(CommandError::internal)
}

#[tauri::command]
pub async fn friends_search(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<SocialProfile>, CommandError> {
    state
        .friends
        .search(query)
        .await
        .map_err(CommandError::internal)
}

#[tauri::command]
pub async fn friends_action(
    action: SocialAction,
    state: State<'_, AppState>,
) -> Result<FriendsStatus, CommandError> {
    let profile = match &action {
        SocialAction::UpdateProfile { profile } => Some(profile.clone()),
        _ => None,
    };
    if let Some(profile) = profile {
        save_profile(&state, profile).await?;
    }
    state
        .friends
        .action(action)
        .await
        .map_err(CommandError::internal)
}

#[tauri::command]
pub async fn friends_invite(
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<FriendsStatus, CommandError> {
    let _guard = ROOM_ACTION
        .try_lock()
        .map_err(|_| CommandError::internal("friends.error.busy"))?;
    let status = state.friends.status();
    if status.connection != "online" {
        return Err(CommandError::internal("friends.error.unreachable"));
    }
    if !status.snapshot.as_ref().is_some_and(|snapshot| {
        snapshot
            .friends
            .iter()
            .any(|friend| friend.profile.id == profile_id)
    }) {
        return Err(CommandError::internal("friends.error.notFriends"));
    }
    super::listen_together::load_profile(&state).await?;
    if state.listen_together.status().await.room_id.is_none() {
        state.friends.stop_listen_along(None).await;
        state
            .listen_together
            .create_room()
            .await
            .map_err(CommandError::internal)?;
        state.friends.announce_room();
    }
    let (join_code, room_token, server_url) = state
        .listen_together
        .invitation_proof()
        .await
        .ok_or_else(|| CommandError::internal("friends.error.invalidRoom"))?;
    if server_url != status.server_url {
        return Err(CommandError::internal("friends.error.invalidRoom"));
    }
    state
        .friends
        .trusted_action(SocialAction::Invite {
            profile_id,
            join_code,
            room_token,
        })
        .await
        .map_err(CommandError::internal)
}

#[tauri::command]
pub async fn friends_accept_invite(
    invitation_id: String,
    state: State<'_, AppState>,
) -> Result<FriendsStatus, CommandError> {
    let _guard = ROOM_ACTION
        .try_lock()
        .map_err(|_| CommandError::internal("friends.error.busy"))?;
    let status = state.friends.status();
    if status.connection != "online" {
        return Err(CommandError::internal("friends.error.unreachable"));
    }
    let invitation = status
        .snapshot
        .as_ref()
        .and_then(|snapshot| {
            snapshot.invitations.iter().find(|invite| {
                invite.id == invitation_id
                    && invite.expires_at_ms > luft_listen_together::server_now_ms()
            })
        })
        .cloned()
        .ok_or_else(|| CommandError::internal("friends.error.invitationExpired"))?;
    let room = state.listen_together.status().await;
    if room.room_id.is_some() && room.join_code.as_deref() != Some(&invitation.join_code) {
        return Err(CommandError::internal("friends.error.alreadyInRoom"));
    }
    if room.server_url != status.server_url {
        return Err(CommandError::internal("friends.error.invalidRoom"));
    }
    if room.room_id.is_some() && room.connection != "online" {
        return Err(CommandError::internal("friends.error.unreachable"));
    }
    if room.room_id.is_none() {
        super::listen_together::load_profile(&state).await?;
        state.friends.stop_listen_along(None).await;
        let joined = state
            .listen_together
            .join_room(invitation.join_code.clone())
            .await
            .map_err(CommandError::internal)?;
        if joined.join_code.as_deref() != Some(&invitation.join_code)
            || joined.room_id.is_none()
            || joined.connection != "online"
        {
            return Err(CommandError::internal("friends.error.invalidRoom"));
        }
    }
    state.friends.announce_room();
    // The room join is already confirmed. A failed notification cleanup must not
    // make the frontend report a failed join or prevent navigation to that room.
    Ok(state
        .friends
        .action(SocialAction::DismissInvite { invitation_id })
        .await
        .unwrap_or_else(|_| state.friends.status()))
}

#[tauri::command]
pub async fn friends_dismiss_invite(
    invitation_id: String,
    state: State<'_, AppState>,
) -> Result<FriendsStatus, CommandError> {
    state
        .friends
        .action(SocialAction::DismissInvite { invitation_id })
        .await
        .map_err(CommandError::internal)
}

async fn save_profile(
    state: &AppState,
    mut profile: SocialProfileInput,
) -> Result<(), CommandError> {
    if !profile.validate() {
        return Err(CommandError::internal("friends.error.invalidProfile"));
    }
    let database = state
        .database
        .get()
        .await
        .map_err(|_| CommandError::internal("friends.error.generic"))?;
    let mut settings = database
        .settings()
        .await
        .map_err(|_| CommandError::internal("friends.error.generic"))?;
    settings.listen_together.display_name = profile.display_name.clone();
    settings.listen_together.avatar_uri = profile.avatar_uri.clone();
    database
        .save_settings(&settings)
        .await
        .map_err(|_| CommandError::internal("friends.error.generic"))?;
    state
        .listen_together
        .set_profile(profile.display_name, profile.avatar_uri)
        .await;
    Ok(())
}

/// The own moving picture or banner, as raw bytes; the kind travels in a header.
#[tauri::command]
pub async fn friends_upload_media(
    request: tauri::ipc::Request<'_>,
    state: State<'_, AppState>,
) -> Result<String, CommandError> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::internal("friends.error.invalidMedia"));
    };
    let kind = request.headers().get("x-media-kind")
        .and_then(|value| value.to_str().ok())
        .and_then(MediaKind::from_key)
        .ok_or_else(|| CommandError::internal("friends.error.invalidMedia"))?;
    let size = bytes.len();
    let result = state.friends.upload_media(kind, bytes.clone(), &state.paths.cache.join("Media")).await;
    match &result {
        Ok(_) => tracing::info!(kind = kind.key(), size, "profile media uploaded"),
        Err(error) => tracing::warn!(kind = kind.key(), size, error = %error, "profile media upload failed"),
    }
    result.map_err(CommandError::internal)
}

/// A profile's media file as raw bytes, from the cache or the server.
#[tauri::command]
pub async fn friends_media(id: String, state: State<'_, AppState>) -> Result<tauri::ipc::Response, CommandError> {
    let bytes = state.friends.media(&id, &state.paths.cache.join("Media")).await.map_err(|error| {
        tracing::warn!(error = %error, "profile media unavailable");
        CommandError::internal(error)
    })?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Follow a friend's playback without a room (friends/listen_along.rs).
#[tauri::command]
pub async fn friends_listen_along(profile_id: String, state: State<'_, AppState>) -> Result<FriendsStatus, CommandError> {
    state.friends.start_listen_along(profile_id).await.map_err(CommandError::internal)?;
    Ok(state.friends.status())
}

/// Stop listening along, or dismiss the note that it ended.
#[tauri::command]
pub async fn friends_listen_along_stop(state: State<'_, AppState>) -> Result<FriendsStatus, CommandError> {
    state.friends.stop_listen_along(None).await;
    Ok(state.friends.status())
}

/// Luft's user overview; the server refuses everyone else.
#[tauri::command]
pub async fn friends_admin_overview(state: State<'_, AppState>) -> Result<luft_listen_together::admin::AdminOverview, CommandError> {
    state.friends.admin_overview().await.map_err(CommandError::internal)
}

/// Luft only: saves the server database to Documents\Luftify\Backups and returns the path.
#[tauri::command]
pub async fn friends_admin_backup(state: State<'_, AppState>) -> Result<String, CommandError> {
    let bytes = state.friends.admin_backup().await.map_err(CommandError::internal)?;
    let directory = crate::commands::analytics::documents_dir()
        .ok_or_else(|| CommandError::internal("luftAdmin.backupFailed"))?
        .join("Luftify")
        .join("Backups");
    tokio::fs::create_dir_all(&directory).await.map_err(|_| CommandError::internal("luftAdmin.backupFailed"))?;
    let path = directory.join(format!("luftify-server-{}.sqlite", chrono::Local::now().format("%Y-%m-%d-%H%M")));
    tokio::fs::write(&path, bytes).await.map_err(|_| CommandError::internal("luftAdmin.backupFailed"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// The recovery code to write down; `renew` makes a new one (friends/recovery.rs).
#[tauri::command]
pub async fn friends_recovery_code(renew: bool, state: State<'_, AppState>) -> Result<String, CommandError> {
    state.friends.recovery_code(renew).await.map_err(CommandError::internal)
}

/// What this PC plays, for the phone that steers it (friends/remote.rs).
#[tauri::command]
pub async fn friends_remote_state(state: luft_listen_together::remote::RemoteState, app: State<'_, AppState>) -> Result<(), CommandError> {
    app.friends.remote_state(state).await;
    Ok(())
}

/// A short code to link a phone to this profile (friends/devices.rs).
#[tauri::command]
pub async fn friends_link_code(state: State<'_, AppState>) -> Result<luft_listen_together::devices::DeviceLink, CommandError> {
    state.friends.link_code().await.map_err(CommandError::internal)
}

#[tauri::command]
pub async fn friends_devices(state: State<'_, AppState>) -> Result<Vec<luft_listen_together::devices::LinkedDevice>, CommandError> {
    state.friends.devices().await.map_err(CommandError::internal)
}

#[tauri::command]
pub async fn friends_remove_device(id: String, state: State<'_, AppState>) -> Result<Vec<luft_listen_together::devices::LinkedDevice>, CommandError> {
    state.friends.remove_device(id).await.map_err(CommandError::internal)
}

/// Brings an existing profile to this device with its recovery code.
#[tauri::command]
pub async fn friends_restore(code: String, state: State<'_, AppState>) -> Result<FriendsStatus, CommandError> {
    let status = state.friends.restore(code).await.map_err(CommandError::internal)?;
    if let Some(me) = status.snapshot.as_ref().map(|snapshot| &snapshot.me) {
        state.listen_together.set_profile(me.display_name.clone(), me.avatar_uri.clone()).await;
    }
    Ok(status)
}
