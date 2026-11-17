import { describe, expect, it } from "vitest";
import type { MediaItem, PlaylistDetails } from "@luft/protocol-types";
import { playlistPlaybackSelection } from "../src/features/entities/playlistPlayback";
import { DEFAULT_PLAYLIST_SORT } from "../src/features/library/playlistSorting";

const track = (uri: string): MediaItem => ({
  uri, source: "spotify", itemType: "track", title: uri,
  creators: [], explicit: false, playable: true,
});
const tracks = [track("spotify:track:a"), track("spotify:track:b")];
const details = { tracks, total: 2, hasMore: false } as PlaylistDetails;
const uri = "spotify:playlist:example";

describe("filtered playlist playback", () => {
  it("keeps exactly the visible order in a local context, including one remaining match", () => {
    for (const visible of [[tracks[1]!, tracks[0]!], [tracks[1]!]]) {
      const result = playlistPlaybackSelection(uri, details, DEFAULT_PLAYLIST_SORT, "artist", visible);
      expect(result.tracks).toEqual(visible);
      expect(result.contextUri).toMatch(/^spotify:search:/);
      expect(result.contextUri).not.toContain(":playlist:");
    }
  });
  it("does not fall back to the whole playlist for an empty result", () => {
    expect(playlistPlaybackSelection(uri, details, DEFAULT_PLAYLIST_SORT, "missing", []).tracks).toEqual([]);
  });
  it("keeps remote playlist loading for an unfiltered partial snapshot", () => {
    const result = playlistPlaybackSelection(uri, { ...details, hasMore: true }, DEFAULT_PLAYLIST_SORT, "  ", tracks);
    expect(result.contextUri).toBe(uri);
    expect(result.tracks).toBeUndefined();
  });
});
