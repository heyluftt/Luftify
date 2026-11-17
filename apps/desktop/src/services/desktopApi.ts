import { invoke } from "@tauri-apps/api/core";
import type {
  AlbumDetails,
  ArtistDetails,
  EntitySummary,
  MediaItem,
  Page,
  PageRequest,
  PlaybackState,
  PlayerCommandRequest,
  PlaylistDetails,
  QueueReorderRequest,
  QueueState,
  SearchRequest,
  SearchResult,
} from "@luft/protocol-types";
import type { ListeningRecap, RecapPreview, RecapPreviewRange, RecapRequest } from "../features/recap/recapTypes";
import type { ListenTogetherStatus, RoomControlAction, RoomControlMode, RoomQueuePolicy, ServerCheck, SharedQueueEdit } from "../features/listen-together/listenTogetherTypes";
import type { AudioOutputDevice, ConnectionInfo, DspSettings, LibrespotStatus, LyricsDocument, LyricsRequest, MiniPlayerSettings, ModuleStatus, PlaylistUsage, Settings, StartupEvent, TransportCommandRequest, VisualizerSnapshot, VolumeCommandRequest, VolumePreviewReceipt, VolumePreviewRequest } from "../types/tauri";
import type {
  AnalyticsRangeRequest,
  DailyListeningActivity,
  ListeningOverview,
  TrackListeningFeedback,
} from "../features/analytics/analyticsTypes";

/** The lock badge in CSS pixels; `scale` is devicePixelRatio. */
export type MiniPlayerUnlockZone = { x: number; y: number; width: number; height: number; scale: number };
/** Warnings and errors count since the app started. */
export type DiagnosticsExport = { path: string; warnings: number; errors: number };
export type CacheScope = "lyrics" | "playlists" | "covers" | "all";
export type CacheClearResult = { removedEntries: number };
export type CacheUsageSection = { bytes: number; entries: number };
export type CacheUsageResult = {
  lyrics: CacheUsageSection;
  playlists: CacheUsageSection;
  covers: CacheUsageSection;
  total: CacheUsageSection;
};

export const desktopApi = {
  saveListenProfile: (name: string, avatarUri: string | null) => invoke<void>("listen_together_save_profile", { name, avatarUri }),
  listenTogetherQueueEdit: (roomId: string, edit: SharedQueueEdit) => invoke<void>("listen_together_queue_edit", { roomId, edit }),
  getMixLibrary: () => invoke<string | null>("get_mix_library"),
  saveMixLibrary: (value: string, expected: string | null) => invoke<boolean>("save_mix_library", { value, expected }),
  playbackState: () => invoke<PlaybackState>("get_playback_state"),
  playerCommand: (request: PlayerCommandRequest) => invoke<PlaybackState>("send_player_command", { request }),
  transportCommand: (request: TransportCommandRequest) => invoke<PlaybackState>("send_transport_command", { request }),
  previewVolume: (request: VolumePreviewRequest) => invoke<VolumePreviewReceipt>("preview_volume", { request }),
  volumeCommand: (request: VolumeCommandRequest) => invoke<PlaybackState>("send_volume_command", { request }),
  playUri: (uri: string, contextTracks?: MediaItem[], preserveQueue = false) => invoke<PlaybackState>("play_uri", { uri, contextTracks, preserveQueue }),
  playContext: (contextUri: string, trackUri: string, contextTracks?: MediaItem[]) => invoke<PlaybackState>("play_context", { contextUri, trackUri, contextTracks }),
  search: (request: SearchRequest, signal?: AbortSignal) => abortable(invoke<SearchResult>("search", { request }), signal),
  playlists: (request: PageRequest) => invoke<Page<EntitySummary>>("get_playlists", { request }),
  newReleases: () => invoke<Page<EntitySummary>>("get_new_releases"),
  cachedPlaylists: (request: PageRequest) => invoke<Page<EntitySummary> | null>("get_cached_playlists", { request }),
  likedTracks: (request: PageRequest) => invoke<Page<import("@luft/protocol-types").MediaItem>>("get_liked_tracks", { request }),
  cachedLikedTracks: (request: PageRequest) => invoke<Page<import("@luft/protocol-types").MediaItem> | null>("get_cached_liked_tracks", { request }),
  setTrackSaved: (uri: string, saved: boolean) => invoke<void>("set_track_saved", { uri, saved }),
  likedTrackUris: () => invoke<string[]>("get_liked_track_uris"),
  playlist: (uri: string, request: PageRequest) => invoke<PlaylistDetails>("get_playlist", { uri, request }),
  cachedPlaylist: (uri: string, request: PageRequest) => invoke<PlaylistDetails | null>("get_cached_playlist", { uri, request }),
  playlistSnapshot: (uri: string) => invoke<PlaylistDetails>("get_playlist_snapshot", { uri }),
  cachedPlaylistSnapshot: (uri: string) => invoke<PlaylistDetails | null>("get_cached_playlist_snapshot", { uri }),
  addTrackToPlaylist: (playlistUri: string, trackUri: string) => invoke<void>("add_track_to_playlist", { playlistUri, trackUri }),
  removeTrackFromPlaylist: (playlistUri: string, playlistEntryId: string, trackUri: string) => invoke<void>("remove_track_from_playlist", { playlistUri, playlistEntryId, trackUri }),
  createPlaylist: (name: string) => invoke<string>("create_playlist", { name }),
  renamePlaylist: (uri: string, name: string) => invoke<void>("rename_playlist", { uri, name }),
  setPlaylistCover: (uri: string, jpeg: string) => invoke<void>("set_playlist_cover", { uri, jpeg }),
  setPlaylistCollaborative: (uri: string, collaborative: boolean) => invoke<void>("set_playlist_collaborative", { uri, collaborative }),
  /** `false` on one's own playlist deletes it, as in Spotify. */
  setPlaylistFollowed: (uri: string, followed: boolean) => invoke<void>("set_playlist_followed", { uri, followed }),
  album: (uri: string, request: PageRequest) => invoke<AlbumDetails>("get_album", { uri, request }),
  artist: (uri: string) => invoke<ArtistDetails>("get_artist", { uri }),
  /** Pictures of several artists in one request; empty unless the built-in engine plays. */
  artistPortraits: (uris: string[]) => invoke<EntitySummary[]>("artist_portraits", { uris }),
  track: (uri: string) => invoke<MediaItem | null>("get_track", { uri }),
  queue: (limit?: number) => invoke<QueueState>("get_queue", { limit: limit ?? null }),
  hydrateQueueItems: (uris: string[]) => invoke<void>("hydrate_queue_items", { uris }),
  addToQueue: (uri: string, track?: MediaItem) => invoke<void>("add_to_queue", { uri, ...(track ? { track } : {}) }),
  removeFromQueue: (uri: string, uid?: string) => invoke<void>("remove_from_queue", { uri, uid: uid ?? null }),
  reorderQueue: (request: QueueReorderRequest) => invoke<QueueState>("reorder_queue", { request }),
  clearQueue: () => invoke<void>("clear_queue"),
  settings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  showMiniplayer: () => invoke<void>("show_miniplayer"),
  setMiniplayerExpanded: (expanded: boolean) => invoke<void>("set_miniplayer_expanded", { expanded }),
  hideMiniplayer: () => invoke<void>("hide_miniplayer"),
  showMainWindow: () => invoke<void>("show_main_window"),
  saveMiniplayerSettings: (settings: MiniPlayerSettings) => invoke<MiniPlayerSettings>("save_miniplayer_settings", { settings }),
  saveMiniplayerPosition: (x: number, y: number) => invoke<void>("save_miniplayer_position", { x, y }),
  setMiniplayerUnlockZone: (zone: MiniPlayerUnlockZone | null) => invoke<void>("set_miniplayer_unlock_zone", { zone }),
  previewDspSettings: (settings: DspSettings) => invoke<void>("preview_dsp_settings", { settings }),
  saveDspSettings: (settings: DspSettings) => invoke<void>("save_dsp_settings", { settings }),
  librespotStatus: () => invoke<LibrespotStatus>("get_librespot_status"),
  librespotAccounts: () => invoke<Array<{ id: string; username: string | null; active: boolean }>>("get_librespot_accounts"),
  switchLibrespotAccount: (profileId: string | null) => invoke<void>("switch_librespot_account", { profileId }),
  startLibrespotLogin: () => invoke<LibrespotStatus>("start_librespot_login"),
  logoutLibrespot: () => invoke<LibrespotStatus>("logout_librespot"),
  audioOutputs: () => invoke<AudioOutputDevice[]>("list_audio_outputs"),
  cacheUsage: () => invoke<CacheUsageResult>("get_cache_usage"),
  clearCache: (scope: CacheScope) => invoke<CacheClearResult>("clear_cache", { scope }),
  playlistUsage: () => invoke<PlaylistUsage[]>("get_playlist_usage"),
  resetPlaylistUsage: () => invoke<void>("reset_playlist_usage"),
  getListeningOverview: (request: AnalyticsRangeRequest) =>
    invoke<ListeningOverview>("get_listening_overview", { request }),
  trackListeningFeedback: (uris: string[]) =>
    invoke<TrackListeningFeedback[]>("get_track_listening_feedback", { uris }),
  clearListeningAnalytics: () =>
    invoke<void>("clear_listening_analytics"),
  listeningRecap: (request: RecapRequest) => invoke<ListeningRecap>("get_listening_recap", { request }),
  recapPreviews: (ranges: RecapPreviewRange[]) => invoke<RecapPreview[]>("get_recap_previews", { ranges }),
  trackPreviews: (uris: string[]) => invoke<{ uri: string; url?: string | null }[]>("get_track_previews", { uris }),
  listeningDays: (timezoneOffsetMinutes: number) =>
    invoke<DailyListeningActivity[]>("get_listening_days", { timezoneOffsetMinutes }),
  saveRecapImage: (pngBase64: string, fileName: string) => invoke<string>("save_recap_image", { pngBase64, fileName }),
  modules: () => invoke<ModuleStatus[]>("get_modules"),
  lyrics: (request: LyricsRequest) => invoke<LyricsDocument>("get_lyrics", { request }),
  connectionInfo: () => invoke<ConnectionInfo>("get_connection_info"),
  startupStatus: () => invoke<StartupEvent>("get_startup_status"),
  respondClosePrompt: (action: "exit" | "tray" | "cancel") => invoke<void>("respond_close_prompt", { action }),
  hideApp: () => invoke<void>("hide_luftplayer"),
  exitApp: () => invoke<void>("exit_luftplayer"),
  exportDiagnostics: () => invoke<DiagnosticsExport>("export_diagnostics"),
  revealDiagnosticsReport: (path: string) => invoke<void>("reveal_diagnostics_report", { path }),
  listenTogetherStatus: () => invoke<ListenTogetherStatus>("listen_together_status"),
  listenTogetherCreateRoom: () => invoke<ListenTogetherStatus>("listen_together_create_room"),
  listenTogetherJoinRoom: (code: string) => invoke<ListenTogetherStatus>("listen_together_join_room", { code }),
  listenTogetherLeave: () => invoke<ListenTogetherStatus>("listen_together_leave"),
  listenTogetherControl: (action: RoomControlAction) => invoke<void>("listen_together_control", { action }),
  listenTogetherSetControl: (mode: RoomControlMode) => invoke<void>("listen_together_set_control", { mode }),
  listenTogetherSetQueuePolicy: (policy: RoomQueuePolicy) => invoke<void>("listen_together_set_queue_policy", { policy }),
  listenTogetherCheckServer: (url?: string) => invoke<ServerCheck>("listen_together_check_server", { url: url ?? null }),
  coverData: (coverUri: string) => invoke<string>("resolve_cover", { coverUri }),
  visualizerFrame: () => invoke<VisualizerSnapshot>("get_visualizer_frame"),
};

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Request cancelled", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Request cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
