/** Remote control between the devices of one friends profile (luft-listen-together/src/remote.rs). */
export type RemoteCommand =
  | { type: "play" } | { type: "pause" } | { type: "next" } | { type: "previous" } | { type: "toggleLike" }
  | { type: "seek"; positionMs: number }
  | { type: "playTracks"; uris: string[]; index: number; contextUri?: string | null; positionMs?: number | null }
  | { type: "queue"; uris: string[] }
  | { type: "setVolume"; volume: number };

export interface RemoteDevice { id: string; label: string; kind: "desktop" | "phone"; player: boolean }

export interface RemoteTrack { provider: "spotify"; uri: string; title?: string; artists?: string[]; coverUri?: string; durationMs?: number }

export interface RemoteState {
  track?: RemoteTrack;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  liked: boolean;
  contextUri?: string;
}
