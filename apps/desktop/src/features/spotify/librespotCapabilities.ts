import type { LibrespotPhase } from "../../types/tauri";

export const LIBRESPOT_PLAYBACK_CAPABILITIES = [
  "player.basic",
  "player.seek",
  "player.volume",
  "player.mute",
  "player.shuffle",
  "player.repeat",
  "player.like",
  "queue.read",
  "queue.add",
  "queue.remove",
  "queue.clear",
  "queue.reorder",
  "playlist.read",
  "album.read",
  "artist.read",
  "lyrics.read",
  "search.tracks",
  "search.artists",
  "search.albums",
  "search.playlists",
  "library.playlists",
  "library.likedTracks",
  "playlist.modify",
] as const;

export type LibrespotPlaybackCapability =
  (typeof LIBRESPOT_PLAYBACK_CAPABILITIES)[number];

export function isLibrespotPlaybackReady(phase: LibrespotPhase | undefined): boolean {
  return phase === "ready";
}

export function hasLibrespotPlaybackCapability(capability: string): boolean {
  return LIBRESPOT_PLAYBACK_CAPABILITIES.includes(capability as LibrespotPlaybackCapability);
}
