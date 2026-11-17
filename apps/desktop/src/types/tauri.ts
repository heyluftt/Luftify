declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export interface CommandError {
  code: string;
  message: string;
  retryable: boolean;
}

export type LibrespotPhase =
  | "disconnected"
  | "needsLogin"
  | "authenticating"
  | "connecting"
  | "ready"
  | "error";

export interface LibrespotStatus {
  phase: LibrespotPhase;
  credentialsPresent: boolean;
  username: string | null;
  message: string | null;
}

export interface Settings {
  theme: string;
  reconnectResumeMode: ReconnectResumeMode;
  closeBehavior: CloseBehavior;
  windowsAutostart: boolean;
  startInTrayOnAutostart: boolean;
  lastRoute: string;
  searchHistoryEnabled: boolean;
  nowPlayingListNavigationEnabled: boolean;
  listeningAnalyticsEnabled: boolean;
  homeFeatureMode: HomeFeatureMode;
  homeFeaturePlaylistUri: string | null;
  lyricsEnabled: boolean;
  songVideosEnabled: boolean;
  experimentalLibreCanvas: boolean;
  lyricsVisuals: LyricsVisualSettings;
  audioControl: AudioControlSettings;
  miniplayer: MiniPlayerSettings;
  librespotAudioDevice?: string | null;
  librespotStreamingQuality?: StreamingQuality;
  librespotLoudness?: LoudnessNormalization;
  listenTogether?: ListenTogetherSettings;
  notifications?: NotificationSettings;
}

/** Which in-app notices show. */
export interface NotificationSettings {
  messages?: boolean;
  friends: boolean;
  invites: boolean;
  rooms: boolean;
  listenAlong: boolean;
  achievements: boolean;
  reports: boolean;
}

/** Libre stream bitrate: 96, 160 or 320 kbps. */
export type StreamingQuality = "low" | "normal" | "high";
export type LoudnessNormalization = "off" | "quiet" | "normal" | "loud";

export interface ListenTogetherSettings {
  serverUrl: string;
  displayName?: string;
  avatarUri?: string | null;
}

export interface MiniPlayerSettings {
  scale: number;
  opacityPercent: number;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  positionX: number | null;
  positionY: number | null;
}

export interface AudioOutputDevice {
  name: string;
  isDefault: boolean;
}

export interface LyricsVisualSettings {
  enabled: boolean;
  mode: LyricsVisualMode;
  spreadPercent: number;
  colorStrengthPercent: number;
  visualizerEnabled: boolean;
  visualizerSensitivityPercent: number;
}

export interface VisualizerFrame {
  energy: number;
  bass: number;
  mid: number;
  high: number;
  beat: number;
}

export interface VisualizerSnapshot extends VisualizerFrame {
  source: "live" | "none";
}

export interface VisualizerAnalysis {
  available: boolean;
  source: "spotifyAnalysis";
  durationMs: number;
  tempo: number;
  beats: VisualizerBeat[];
  energy: VisualizerEnergyPoint[];
}

export interface VisualizerBeat {
  startMs: number;
  strength: number;
}

export interface VisualizerEnergyPoint {
  startMs: number;
  durationMs: number;
  energy: number;
}

export type LyricsVisualMode = "pulse" | "waves";

export type VolumeCurve = "linear" | "perceptual";

export interface DspSettings {
  enabled: boolean;
  presetId: string;
  preampDb: number;
  autoHeadroom: boolean;
  limiterEnabled: boolean;
  volumeBoostEnabled: boolean;
  volumeBoostDb: number;
  bandsDb: number[];
  spatial: SpatialSettings;
}

export interface SpatialSettings {
  cabinMode?: boolean;
  enabled: boolean;
  presetId: string;
  mixPercent: number;
  preDelayMs: number;
  decaySeconds: number;
  dampingPercent: number;
  stereoWidthPercent: number;
}

export interface AudioControlSettings {
  enabled: boolean;
  presets: number[];
  stepPercent: 1 | 2 | 5 | 10;
  wheelEnabled: boolean;
  restoreOnStart: boolean;
  rememberBeforeMute: boolean;
  showPercentage: boolean;
  curve: VolumeCurve;
  shortcutsEnabled: boolean;
  volumeUpShortcut: string;
  volumeDownShortcut: string;
  muteShortcut: string;
  dsp: DspSettings;
}

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  defaultEnabled: boolean;
}

export interface ModuleStatus {
  manifest: ModuleManifest;
  enabled: boolean;
  available: boolean;
}

export type ReconnectResumeMode = "never" | "ifWasPlaying" | "always";
export type CloseBehavior = "exit" | "minimizeToTray" | "ask";
export type HomeFeatureMode = "lastPlayed" | "mostPlayed" | "personalized" | "fixed";

export interface PlaylistUsage {
  playlistUri: string;
  playCount: number;
  lastPlayedAt: number;
}

export interface LyricsRequest {
  trackUri: string;
  trackName: string;
  artistName: string;
  artistNames: string[];
  albumName: string;
  durationMs: number;
  coverUri?: string;
}

export interface LyricsLine {
  startMs: number | null;
  text: string;
}

export interface LyricsDocument {
  provider: string;
  synced: boolean;
  instrumental: boolean;
  lines: LyricsLine[];
}

export type StartupPhase =
  | "appInitializing"
  | "cacheLoading"
  | "ready"
  | "degraded";

export interface StartupEvent {
  phase: StartupPhase;
  elapsedMs: number;
  sequence: number;
}

/** Process facts the window cannot derive from events: demo mode and the startup phase. */
export interface ConnectionInfo {
  mockMode: boolean;
  startup: StartupEvent;
}

export interface TransportCommandRequest {
  requestId: string;
  action: "next" | "previous";
  createdAtMs: number;
  sentAtMs: number;
  expiresAtMs: number;
  connectionEpoch: number;
  createdTrackGeneration: number;
  trackGeneration: number;
  trackUriBefore?: string;
  positionBeforeMs: number;
}

export interface VolumeCommandRequest {
  requestId: string;
  sequence: number;
  connectionEpoch: number;
  createdAtMs: number;
  sentAtMs: number;
  uiVolume: number;
  volume: number;
  curve: VolumeCurve;
  unmute: boolean;
}

export interface VolumePreviewRequest extends VolumeCommandRequest {}

export interface VolumePreviewReceipt {
  requestId: string;
  sequence: number;
  rustReceivedAtMs: number;
  rustQueuedAtMs: number;
}

export interface VolumeEventTrace {
  volume: number;
  isMuted: boolean;
  eventTimestampMs: number;
  preview?: boolean;
  requestId?: string;
  sequence?: number;
  connectionEpoch?: number;
  createdAtMs?: number;
  rustQueuedAtMs?: number;
}

