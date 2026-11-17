mod commands;
mod cover_protocol;
mod error;
mod events;
mod friends;
mod lifecycle;
mod listen_together;
mod listening_analytics;
mod miniplayer;
mod provider;
mod release_page;
mod session_guard;
mod song_memory;
mod startup;
mod state;
mod thumbbar;
mod tray;
mod updater;
mod webview_memory;

use std::{sync::Arc, time::Instant};

use luft_core::{MockSpotifyProvider, SpotifyProvider};
use luft_infrastructure::{AppPaths, CoverCache, DatabaseHandle, init_logging};
use luft_librespot::LibrespotService;
use luft_setup::WindowsAutostartService;
use state::{AppState, PlaylistRefreshState};
use tauri::Manager;
use tracing::info;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_started_at = Instant::now();
    let allow_multi = std::env::args().any(|argument| argument == "--multi-instance");
    let mut context = tauri::generate_context!();
    let active_paths = AppPaths::discover().expect("failed to resolve account profile");
    let base_paths = AppPaths::discover_base().expect("failed to resolve account directory");
    if active_paths.data != base_paths.data {
        for window in &mut context.config_mut().app.windows {
            window.data_directory = Some(active_paths.data.join("Webview"));
        }
    }
    let mut builder = tauri::Builder::default();
    if !allow_multi {
        builder = builder.plugin(tauri_plugin_single_instance::init(handle_second_instance));
    }
    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol(cover_protocol::SCHEME, cover_protocol::handle)
        .on_window_event(lifecycle::handle_window_event)
        .setup(move |app| {
            let autostart_launch = std::env::args().any(|argument| argument == "--autostart");
            let window_visible_ms = if autostart_launch {
                if let Some(window) = app.get_webview_window("main") {
                    window.hide()?;
                }
                0
            } else if let Some(window) = app.get_webview_window("main") {
                window.show()?;
                backend_started_at.elapsed().as_millis()
            } else {
                0
            };
            let mock_mode = mock_mode_from_args(std::env::args());
            let state = tauri::async_runtime::block_on(build_state(
                mock_mode,
                backend_started_at,
                app.handle().clone(),
            ))?;
            let database = state.database.clone();
            let startup = Arc::clone(&state.startup);
            startup.reset_metrics(window_visible_ms);
            let startup_services = state.startup_services(autostart_launch);
            app.manage(state);
            updater::manage(app.handle());
            let tray_state = tray::create(app.handle())?;
            app.manage(tray_state);
            tray::spawn_watchers(app.handle().clone());
            miniplayer::start_overlay_watch(app.handle().clone());
            session_guard::start_watchdog(app.handle().clone());
            thumbbar::attach(app.handle());
            events::forward_librespot_status(
                app.handle().clone(),
                Arc::clone(&app.state::<AppState>().librespot),
            );
            events::forward_key_waits(app.handle().clone());
            if !mock_mode {
                events::forward_librespot_playback(
                    app.handle().clone(),
                    Arc::clone(&app.state::<AppState>().librespot),
                    app.state::<AppState>().listening_analytics.clone(),
                    database,
                );
                song_memory::spawn(app.state::<AppState>().database.clone(), Arc::clone(&app.state::<AppState>().librespot));
            }
            tauri::async_runtime::spawn(startup.run(app.handle().clone(), startup_services));
            info!(
                phase = "window-visible",
                duration_ms = window_visible_ms,
                status = "shown",
                adapter = "tauri-window",
                "startup timing"
            );
            info!(
                mock_mode,
                version = env!("CARGO_PKG_VERSION"),
                phase = "backend-started",
                duration_ms = backend_started_at.elapsed().as_millis(),
                adapter = if mock_mode {
                    "mock-provider"
                } else {
                    "librespot"
                },
                "startup timing"
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::accounts::get_librespot_accounts,
            commands::accounts::switch_librespot_account,
            commands::cache::clear_cache,
            commands::cache::get_cache_usage,
            commands::analytics::get_listening_overview,
            commands::analytics::get_listening_recap,
            commands::analytics::get_listening_days,
            commands::analytics::get_recap_previews,
            commands::analytics::save_recap_image,
            commands::analytics::get_recently_played,
            commands::analytics::get_track_listening_feedback,
            commands::analytics::clear_listening_analytics,
            commands::playback::get_playback_state,
            commands::playback::send_player_command,
            commands::playback::send_transport_command,
            commands::playback::preview_volume,
            commands::playback::send_volume_command,
            commands::playback::play_uri,
            commands::playback::play_context,
            commands::home::get_playlist_usage,
            commands::mixes::get_mix_library,
            commands::mixes::save_mix_library,
            commands::home::reset_playlist_usage,
            commands::home::get_new_releases,
            commands::search::search,
            commands::listen_together::listen_together_status,
            commands::friends::friends_status,
            commands::chat::chat_inbox,
            commands::chat::chat_messages,
            commands::chat::chat_send,
            commands::chat::chat_read,
            commands::friends::friends_refresh,
            commands::friends::friends_activate,
            commands::friends::friends_search,
            commands::friends::friends_action,
            commands::friends::friends_invite,
            commands::friends::friends_accept_invite,
            commands::friends::friends_dismiss_invite,
            commands::friends::friends_upload_media,
            commands::friends::friends_media,
            commands::friends::friends_listen_along,
            commands::friends::friends_listen_along_stop,
            commands::friends::friends_admin_overview,
            commands::friends::friends_admin_backup,
            commands::friends::friends_recovery_code,
            commands::friends::friends_link_code,
            commands::friends::friends_remote_state,
            commands::friends::friends_devices,
            commands::friends::friends_remove_device,
            commands::friends::friends_restore,
            commands::client_log::client_log,
            commands::listen_together::listen_together_create_room,
            commands::listen_together::listen_together_join_room,
            commands::listen_together::listen_together_leave,
            commands::listen_together::listen_together_queue_edit,
            commands::listen_together::listen_together_save_profile,
            commands::listen_together::listen_together_control,
            commands::listen_together::listen_together_set_control,
            commands::listen_together::listen_together_set_queue_policy,
            updater::app_update_check,
            updater::app_update_install,
            updater::app_update_open_page,
            commands::listen_together::listen_together_check_server,
            commands::library::get_playlists,
            commands::library::get_cached_playlists,
            commands::library::get_liked_tracks,
            commands::library::get_cached_liked_tracks,
            commands::library::get_liked_track_uris,
            commands::library::set_track_saved,
            commands::library::get_playlist,
            commands::library::get_cached_playlist,
            commands::library::get_playlist_snapshot,
            commands::library::get_cached_playlist_snapshot,
            commands::library::add_track_to_playlist,
            commands::library::remove_track_from_playlist,
            commands::library::get_album,
            commands::library::get_artist,
            commands::library::artist_portraits,
            commands::links::get_track,
            commands::playlist_manage::create_playlist,
            commands::playlist_manage::rename_playlist,
            commands::playlist_manage::set_playlist_cover,
            commands::playlist_manage::set_playlist_collaborative,
            commands::playlist_manage::set_playlist_followed,
            commands::library::get_queue,
            commands::library::add_to_queue,
            commands::library::remove_from_queue,
            commands::library::hydrate_queue_items,
            commands::library::clear_queue,
            commands::library::reorder_queue,
            commands::lyrics::get_lyrics,
            commands::modules::get_modules,
            commands::miniplayer::show_miniplayer,
            commands::miniplayer::show_main_window,
            commands::miniplayer::set_miniplayer_expanded,
            commands::miniplayer::hide_miniplayer,
            commands::miniplayer::save_miniplayer_settings,
            commands::miniplayer::save_miniplayer_position,
            commands::miniplayer::set_miniplayer_unlock_zone,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::librespot::get_librespot_status,
            commands::librespot::probe_lossless,
            commands::librespot::start_librespot_login,
            commands::librespot::logout_librespot,
            commands::librespot::get_track_previews,
            commands::librespot::list_audio_outputs,
            commands::librespot::preview_dsp_settings,
            commands::librespot::save_dsp_settings,
            commands::setup::get_connection_info,
            commands::setup::get_startup_status,
            commands::setup::respond_close_prompt,
            commands::setup::hide_luftplayer,
            commands::setup::exit_luftplayer,
            commands::diagnostics::export_diagnostics,
            commands::problem_report::problem_report_preview,
            commands::problem_report::problem_report_send,
            commands::problem_report::problem_reports_list,
            commands::problem_report::problem_report_get,
            commands::problem_report::problem_report_delete,
            commands::session::previous_session,
            commands::session::dismiss_previous_session,
            commands::session::set_window_idle,
            commands::diagnostics::reveal_diagnostics_report,
            commands::covers::resolve_cover,
            commands::visualizer::get_visualizer_frame,
        ])
        .run(context)
        .expect("failed to run desktop application");
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SecondInstanceAction {
    ShowExistingMainWindow,
}

fn second_instance_action() -> SecondInstanceAction {
    SecondInstanceAction::ShowExistingMainWindow
}

fn handle_second_instance(app: &tauri::AppHandle, _arguments: Vec<String>, _cwd: String) {
    match second_instance_action() {
        SecondInstanceAction::ShowExistingMainWindow => lifecycle::show_main_window(app),
    }
}

/// `--mock` runs the demo provider, `--libre` the real engine. Debug builds
/// default to the mock so `tauri dev` works without a Spotify account.
fn mock_mode_from_args<I, S>(arguments: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut explicit_mode = None;
    for argument in arguments {
        match argument.as_ref() {
            "--mock" => explicit_mode = Some(true),
            "--libre" | "--bridge" => explicit_mode = Some(false),
            _ => {}
        }
    }
    explicit_mode.unwrap_or(cfg!(debug_assertions))
}

async fn build_state(
    mock_mode: bool,
    started_at: Instant,
    app: tauri::AppHandle,
) -> Result<AppState, Box<dyn std::error::Error>> {
    let paths = AppPaths::discover()?;
    let logging_guard = init_logging(&paths.logs)?;
    let session = session_guard::SessionGuard::start(&paths.data, app.package_info().version.to_string());
    let database = DatabaseHandle::new(paths.database.clone());
    let cover_cache = CoverCache::new(paths.cache.join("Covers"))?;
    let lyrics = luft_infrastructure::LyricsService::new()?;
    let startup_metrics = paths.logs.join("startup-latest.jsonl");
    let listening_analytics =
        listening_analytics::ListeningAnalyticsService::start(app.clone(), database.clone());
    let librespot = LibrespotService::new(paths.librespot_dir());
    let provider: Arc<dyn SpotifyProvider> = if mock_mode {
        Arc::new(MockSpotifyProvider::new())
    } else {
        Arc::new(provider::LibreProvider::new(Arc::clone(&librespot)))
    };
    let listen_together_url = match database.get().await {
        Ok(database) => database
            .settings()
            .await
            .map(|settings| settings.listen_together.server_url)
            .unwrap_or_else(|_| luft_listen_together::DEFAULT_SYNC_URL.into()),
        Err(_) => luft_listen_together::DEFAULT_SYNC_URL.into(),
    };
    let listen_together = listen_together::ListenTogetherService::start(
        app.clone(),
        Arc::clone(&provider),
        listen_together_url.clone(),
    );
    let friends = friends::FriendsService::start(app, Arc::clone(&provider), listen_together.clone(),
        database.clone(), &paths.data, listen_together_url)?;
    Ok(AppState {
        provider,
        librespot,
        database,
        paths,
        cover_cache,
        lyrics,
        autostart: WindowsAutostartService,
        startup: startup::StartupCoordinator::new(started_at, startup_metrics),
        lifecycle: lifecycle::AppLifecycle::new(),
        listening_analytics,
        listen_together,
        friends,
        session,
        mock_mode,
        playlist_refresh: tokio::sync::Mutex::new(PlaylistRefreshState {
            request: None,
            completed_at: None,
            page: None,
        }),
        _logging_guard: logging_guard,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_mock_argument_enables_mock_provider() {
        assert!(mock_mode_from_args(["app.exe", "--mock"]));
    }

    #[test]
    fn explicit_libre_argument_enables_real_provider() {
        assert!(!mock_mode_from_args(["app.exe", "--libre"]));
    }

    #[test]
    fn last_explicit_mode_wins() {
        assert!(!mock_mode_from_args(["app.exe", "--mock", "--libre"]));
    }

    #[test]
    fn second_instance_targets_the_existing_main_window() {
        assert_eq!(
            second_instance_action(),
            SecondInstanceAction::ShowExistingMainWindow
        );
    }
}
