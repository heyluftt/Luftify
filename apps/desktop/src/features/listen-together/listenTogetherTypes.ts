import type { SocialRole } from "../friends/friendsTypes";

export interface ListenTogetherParticipant {
  avatarUri?: string | null;
  id: string;
  displayName: string;
  isHost: boolean;
  connected: boolean;
  /** Verified by the server from the member's friends profile. */
  roles?: SocialRole[];
  badges?: string[];
}

export interface ListenTogetherStatus {
  queue?: SharedQueueSnapshot | null;
  connection: "idle" | "connecting" | "online" | "reconnecting" | string;
  serverUrl: string;
  role: "none" | "host" | "guest" | string;
  roomId?: string | null;
  joinCode?: string | null;
  hostName?: string | null;
  hostConnected: boolean;
  participants: ListenTogetherParticipant[];
  control: RoomControlMode | string;
  /** Whether guests may move and remove others' songs. */
  queuePolicy?: RoomQueuePolicy;
  pingMs?: number | null;
  revision: number;
  driftMs: number;
  lastSyncMs?: number | null;
  reconnectAttempts: number;
  error?: string | null;
  /** Your participant id, to recognise your own songs. */
  youId?: string | null;
  /** Whether you may play, pause, seek and skip others' songs. */
  canControl?: boolean;
}

export type RoomControlMode = "hostOnly" | "everyone";
export type RoomQueuePolicy = "open" | "ownSongs";
/** Songs added together, e.g. one playlist. */
export interface SharedQueueGroup { id: string; name: string }
export type RoomControlAction = { type: "play" } | { type: "pause" } | { type: "seek"; positionMs: number };
export interface ServerCheck { reachable: boolean; compatible: boolean; protocol?: number | null; latencyMs?: number | null; error?: string | null }

export const DEFAULT_LISTEN_TOGETHER = {
  serverUrl: "wss://luftify-server.invalid",
};

export interface SharedTrack { provider: string; uri: string; title?: string; durationMs?: number; coverUri?: string; artists?: string[] }
export interface SharedQueueEntry { id: string; track: SharedTrack; addedById?: string; addedByName?: string; group?: SharedQueueGroup | null }
export interface SharedQueueSnapshot { revision: number; current?: SharedQueueEntry | null; items: SharedQueueEntry[] }
export type SharedQueueEdit =
  | { type: "playNow"; track: SharedTrack }
  | { type: "playQueued"; id: string }
  | { type: "add"; track: SharedTrack }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; beforeId: string | null }
  /** Up to ROOM_BATCH_TRACKS songs; `next` puts them before everything waiting. */
  | { type: "addMany"; tracks: SharedTrack[]; next: boolean; group?: SharedQueueGroup }
  | { type: "removeMany"; ids: string[] }
  | { type: "moveMany"; ids: string[]; beforeId: string | null }
  | { type: "shuffle" }
  | { type: "clear" };
