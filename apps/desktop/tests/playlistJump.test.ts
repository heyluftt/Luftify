import type { MediaItem } from "@luft/protocol-types";
import { describe, expect, it } from "vitest";
import { findFocusTrackIndex } from "../src/components/trackFocus";
import { playbackContextPlaylistUri } from "../src/features/playback/usePlaybackPlaylistContext";

const track = (id: string, title: string, artist: string): MediaItem => ({
  uri: `spotify:track:${id}`, title, source: "spotify", itemType: "track",
  creators: [{ name: artist }], explicit: false, playable: true,
});

describe("From: playlist jump", () => {
  it("finds the playlist behind filtered and legacy playback contexts", () => {
    expect(playbackContextPlaylistUri("spotify:playlist:abc")).toBe("spotify:playlist:abc");
    expect(playbackContextPlaylistUri(`spotify:search:${encodeURIComponent("spotify:playlist:abc")}`))
      .toBe("spotify:playlist:abc");
    expect(playbackContextPlaylistUri("spotify:user:luft:playlist:abc")).toBe("spotify:playlist:abc");
    expect(playbackContextPlaylistUri("spotify:search:luftify-discovery-mix1")).toBeUndefined();
    expect(playbackContextPlaylistUri("spotify:album:abc")).toBeUndefined();
  });

  it("lands on a relinked track by title and lead artist when the URI differs", () => {
    const tracks = [track("a", "Dolce", "Nino Hofmann"), track("b", "Mille", "Satix")];
    expect(findFocusTrackIndex(tracks, "spotify:track:b")).toBe(1);
    expect(findFocusTrackIndex(tracks, "spotify:track:relinked", { title: "Mille ", creators: [{ name: "satix" }] })).toBe(1);
    expect(findFocusTrackIndex(tracks, "spotify:track:other", { title: "Mille", creators: [{ name: "Someone" }] })).toBe(-1);
  });
});
