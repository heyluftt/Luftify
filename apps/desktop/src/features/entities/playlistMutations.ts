import type { MediaItem, PlaylistDetails } from "@luft/protocol-types";
import { canonicalPlaylistUri } from "./playlistSnapshot";

export function withoutPlaylistEntry(
  details: PlaylistDetails,
  playlistEntryId: string,
): PlaylistDetails {
  return removePlaylistTrackAt(
    details,
    details.tracks.findIndex((track) => track.playlistEntryId === playlistEntryId),
  );
}

export function withoutPlaylistTrack(
  details: PlaylistDetails,
  track: Pick<MediaItem, "uri" | "playlistEntryId">,
): PlaylistDetails {
  const index = details.tracks.findIndex((item) =>
    track.playlistEntryId
      ? item.playlistEntryId === track.playlistEntryId
      : item.uri === track.uri,
  );
  return removePlaylistTrackAt(details, index);
}

/** Mirrors a URI-based remote delete, which drops every occurrence. */
export function withoutPlaylistUri(details: PlaylistDetails, uri: string): PlaylistDetails {
  const tracks = details.tracks.filter((track) => track.uri !== uri);
  const removed = details.tracks.length - tracks.length;
  if (removed === 0) return details;
  return {
    ...details,
    tracks,
    ...(details.total === undefined ? {} : { total: Math.max(0, details.total - removed) }),
  };
}

function removePlaylistTrackAt(
  details: PlaylistDetails,
  index: number,
): PlaylistDetails {
  if (index < 0) {
    return details;
  }

  return {
    ...details,
    tracks: details.tracks.filter((_, itemIndex) => itemIndex !== index),
    ...(details.total === undefined
      ? {}
      : { total: Math.max(0, details.total - 1) }),
  };
}

export function withAddedPlaylistTrack(
  details: PlaylistDetails,
  track: MediaItem,
): PlaylistDetails {
  if (details.tracks[0]?.uri === track.uri) {
    return details;
  }
  const added: MediaItem = {
    ...track,
    addedAt: new Date().toISOString(),
    playlistEntryId: track.playlistEntryId ?? `added-${Date.now()}`,
  };
  return {
    ...details,
    tracks: [added, ...details.tracks],
    ...(details.total === undefined
      ? {}
      : { total: details.total + 1 }),
    hasMore: details.hasMore,
  };
}

export function matchesPlaylistSnapshotQuery(
  queryKey: readonly unknown[],
  playlistUri: string,
): boolean {
  const root = queryKey[0];
  if (root !== "playlist-snapshot" && root !== "playlist-snapshot-cache") {
    return false;
  }
  const canonical = canonicalPlaylistUri(playlistUri);
  return queryKey.some((part) => part === playlistUri || part === canonical);
}
