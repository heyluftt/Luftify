import type { EntitySummary, MediaItem } from "@luft/protocol-types";
import type { ThemeMode } from "../../themes/theme";
import type { SpotifyLink } from "../links/spotifyLink";
import type { SearchEntityCategory } from "../search/searchEntityKind";

export type PaletteGroup =
  | "link"
  | "intent"
  | "recent"
  | "suggested"
  | "playback"
  | "commands"
  | "library"
  | "spotify"
  | "navigate"
  | "sound"
  | "appearance"
  | "commands-late"
  | "search";

/** Names of lucide icons the row can show (see `PaletteIcon`). */
export type PaletteIconName =
  | "search" | "play" | "pause" | "next" | "previous" | "heart" | "heart-off" | "shuffle"
  | "repeat" | "repeat-one" | "queue" | "album" | "artist" | "playlist" | "home" | "library"
  | "lyrics" | "insights" | "recaps" | "listen" | "settings" | "modules" | "diagnostics" | "theme"
  | "volume" | "mute" | "seek" | "equalizer" | "room" | "miniplayer" | "link" | "track"
  | "liked" | "context";

export type PaletteMedia =
  | { kind: "track"; track: MediaItem; context?: { uri: string; tracks: MediaItem[] } }
  | { kind: "entity"; category: SearchEntityCategory; entry: EntitySummary }
  | { kind: "liked" };

export type PaletteAction =
  | { kind: "command"; id: string }
  | { kind: "navigate"; path: string; state?: unknown }
  | { kind: "search"; query: string }
  | { kind: "volume"; percent: number }
  | { kind: "seek"; ms: number }
  | { kind: "theme"; mode: ThemeMode }
  | { kind: "equalizer"; presetId: string }
  | { kind: "room"; presetId: string }
  | { kind: "media"; media: PaletteMedia }
  | { kind: "link"; link: SpotifyLink };

export type PaletteItem = {
  /** Stable across renders: the selection follows it when results arrive. */
  id: string;
  group: PaletteGroup;
  label: string;
  subtitle?: string;
  keywords: string[];
  icon: PaletteIconName;
  cover?: string;
  hint?: string;
  /** Shown instead of the icon's accent: this state is on now. */
  active?: boolean;
  disabled?: boolean;
  action: PaletteAction;
};

export function isMedia(item: PaletteItem | undefined): item is PaletteItem & { action: { kind: "media" } } {
  return item?.action.kind === "media";
}

/** Tracks can be queued; albums, playlists and artists can be opened. */
export function mediaCanQueue(item: PaletteItem | undefined): boolean {
  return isMedia(item) && item.action.media.kind === "track";
}

export function mediaCanOpen(item: PaletteItem | undefined): boolean {
  if (!isMedia(item)) return false;
  const media = item.action.media;
  return media.kind === "entity" || media.kind === "liked" || Boolean(media.kind === "track" && media.track.albumUri);
}
