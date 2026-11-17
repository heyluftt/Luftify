import type { MediaItem, PlaylistDetails } from "@luft/protocol-types";
import { playlistPlaybackTracks, type PlaylistSort } from "../library/playlistSorting";

export function playlistPlaybackSelection(
  playlistUri: string,
  details: PlaylistDetails,
  sort: PlaylistSort,
  searchQuery: string,
  visibleTracks: MediaItem[],
) {
  if (searchQuery.trim()) {
    // Search contexts keep an explicit local list and never expand from the remote playlist.
    return {
      contextUri: `spotify:search:${encodeURIComponent(playlistUri)}`,
      tracks: visibleTracks,
    };
  }
  return { contextUri: playlistUri, tracks: playlistPlaybackTracks(details, sort) };
}
