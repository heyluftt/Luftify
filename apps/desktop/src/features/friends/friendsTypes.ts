import type { SharedTrack } from "../listen-together/listenTogetherTypes";

/** Mirrors luft-listen-together::social. Private credentials never enter the webview. */
export interface SocialProfileInput { displayName: string; avatarUri: string | null }
/** Assigned by the server only. Ordered by rank; unknown roles are ignored. */
export type SocialRole = "luft" | "dev" | "heart" | "crew" | "tester";
export interface SocialProfile extends SocialProfileInput {
  id: string;
  friendCode: string;
  roles?: SocialRole[];
  /** Ids from SocialSnapshot.badges. */
  badges?: string[];
  bio?: string | null;
  style?: ProfileStyle | null;
  /** The song pinned to the profile. */
  favorite?: SharedTrack | null;
  /** Achievements reached; each is a badge in the inventory. */
  achievements?: string[];
}
/** Keys from the fixed palettes in luft-listen-together::appearance. */
export interface ProfileStyle {
  accent: string;
  banner: string;
  /** Avatar ring: "" keeps the role ring. */
  frame?: string;
  effect?: string;
  nameGradient?: boolean;
  /** The row of achievements in the profile. */
  showTrophies?: boolean;
  emoji?: string | null;
  /** Own colour `#rrggbb`; `accent` is then the nearest preset for older apps. */
  color?: string | null;
  /** Where the name gradient runs to and starts from; without a start, the profile colour. */
  nameColor?: string | null;
  nameFrom?: string | null;
  /** Media ids: a moving picture (the still one stays `avatarUri`) and an own banner. */
  avatarMedia?: string | null;
  bannerMedia?: string | null;
  /** Badges shown, in order (`role:<key>`, `badge:<id>`); the rest stay in the inventory. */
  shownBadges?: string[] | null;
}
/** A badge Luft made; icon and colour are keys from a fixed set. */
export interface BadgeDefinition { id: string; label: string; icon: string; color: string }
export type PresenceMode = "auto" | "away" | "busy" | "invisible";
export type Activity = "offline" | "online" | "away" | "busy";
export interface SocialOptions { discoverable: boolean; shareOnline: boolean; shareListening: boolean; allowInvites: boolean; presenceMode?: PresenceMode }
export interface FriendPresence {
  online: boolean;
  track: (SharedTrack & { contextUri?: string | null }) | null;
  isPlaying: boolean;
  activity?: Activity;
  lastSeenMs?: number | null;
  /** Where the shared track was at `positionAtMs` (server time); only with the track. */
  positionMs?: number | null;
  positionAtMs?: number | null;
}
export interface RecentTrack { track: SharedTrack; playedAtMs: number }
export interface FriendEntry {
  profile: SocialProfile;
  presence: FriendPresence;
  recent?: RecentTrack[];
  sinceMs?: number | null;
  /** I hide what I play from this friend (they are not told). */
  listeningHidden?: boolean;
}
/** Only for Luft and developers. */
export interface ServerOverview { profiles: number; online: number; listening: number; rooms: number; team: SocialProfile[] }
export interface FriendRequest { id: string; profile: SocialProfile; createdAtMs: number }
export interface FriendInvitation { id: string; from: SocialProfile; joinCode: string; expiresAtMs: number }
export interface SharedPlaylist { uri: string; name: string; coverUri?: string | null }
/** A playlist a friend sent to join. */
export interface PlaylistShare { id: string; from: SocialProfile; playlist: SharedPlaylist; createdAtMs: number }
export interface SocialSnapshot {
  me: SocialProfile;
  options: SocialOptions;
  friends: FriendEntry[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  invitations: FriendInvitation[];
  blocked: SocialProfile[];
  server?: ServerOverview | null;
  badges?: BadgeDefinition[];
  /** Your own recent tracks, as friends see them. */
  recent?: RecentTrack[];
  /** Friends listening along with you right now (profile ids). */
  listeners?: string[];
  /** Your achievements with their progress. */
  achievementProgress?: AchievementState[];
  /** A line from Luft for everyone, e.g. before maintenance. */
  announcement?: string | null;
  /** Playlists friends sent to join, newest first. */
  playlistShares?: PlaylistShare[];
  playlistAccounts?: { profileId: string; accountKey: string }[];
}
export interface ServerSettings { signupsOpen: boolean; announcement?: string | null }
export interface AchievementState { id: string; unlockedAtMs?: number | null; progress: number; goal: number }
export interface FriendsStatus {
  serverUrl: string;
  connection: "inactive" | "online" | "offline";
  snapshot: SocialSnapshot | null;
  error: string | null;
  /** Listening along with a friend, without a room. */
  listenAlong?: ListenAlongStatus | null;
}
export interface ListenAlongStatus {
  profileId: string;
  /** "paused": the friend paused; "ended" keeps the reason until dismissed. */
  phase: "connecting" | "following" | "paused" | "ended";
  reason: string | null;
}
// Room credentials are added in Rust; they are deliberately absent here.
export type SocialAction =
  | { type: "bindPlaylistAccount"; accountKey: string }
  | { type: "request"; friendCode: string }
  | { type: "respondRequest"; requestId: string; accept: boolean }
  | { type: "cancelRequest"; requestId: string }
  | { type: "removeFriend"; profileId: string }
  | { type: "block"; profileId: string }
  | { type: "unblock"; profileId: string }
  | { type: "updateProfile"; profile: SocialProfileInput }
  | { type: "updateOptions"; options: SocialOptions }
  | { type: "dismissInvite"; invitationId: string }
  | { type: "setRole"; profileId: string; role: SocialRole; enabled: boolean }
  | { type: "setFriendCode"; code: string }
  | { type: "saveBadge"; badge: BadgeDefinition }
  | { type: "deleteBadge"; id: string }
  | { type: "setBadge"; profileId: string; badgeId: string; enabled: boolean }
  | { type: "setBio"; bio: string | null }
  | { type: "setStyle"; style: ProfileStyle | null }
  | { type: "setFavorite"; track: SharedTrack | null }
  /** Luft only; never Luft itself. */
  | { type: "moderate"; profileId: string; moderation: "suspend" | "unsuspend" | "clearProfile" | "resetName" }
  /** Luft only: sign-ups and the announcement for everyone. */
  | { type: "setServerSettings"; settings: ServerSettings }
  | { type: "setListeningHidden"; profileId: string; hidden: boolean }
  | { type: "sharePlaylist"; profileId: string; playlist: SharedPlaylist }
  | { type: "dismissPlaylistShare"; shareId: string };

export type FriendsOperation =
  | { type: "refresh" }
  | { type: "activate"; profile: SocialProfileInput }
  | { type: "action"; action: SocialAction }
  | { type: "invite"; profileId: string }
  | { type: "acceptInvite"; invitationId: string }
  | { type: "dismissInvite"; invitationId: string }
  | { type: "listenAlong"; profileId: string }
  | { type: "stopListenAlong" }
  | { type: "restore"; code: string };
export interface FriendsControls {
  pending: boolean;
  send: (operation: FriendsOperation, onSuccess?: (status: FriendsStatus) => void) => void;
}

/** A code another device enters once to join this profile. */
export interface DeviceLink { code: string; expiresAtMs: number }
export interface LinkedDevice { id: string; label: string; createdAtMs: number; lastSeenMs?: number | null; current?: boolean }
