import { describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@luft/protocol-types";
import {
  isPlayableAlbumUri,
  isPlayableArtistUri,
  playLibraryContext,
  playLibraryTrack,
} from "../src/features/entities/entityPlayback";

const track = (uri: string, albumUri?: string): MediaItem => ({
  uri,
  source: "spotify",
  itemType: "track",
  title: uri,
  creators: [{ name: "Kavinsky" }],
  durationMs: 180_000,
  explicit: false,
  playable: true,
  ...(albumUri ? { albumUri } : {}),
});

describe("entity playback", () => {
  it("recognizes album and artist context uris", () => {
    expect(isPlayableAlbumUri("spotify:album:outrun")).toBe(true);
    expect(isPlayableArtistUri("spotify:artist:kavinsky")).toBe(true);
    expect(isPlayableAlbumUri("spotify:track:nightcall")).toBe(false);
  });

  it("plays a popular artist track inside the artist context", () => {
    const playUri = vi.fn();
    const playContext = vi.fn();
    const popular = [
      track("spotify:track:one"),
      track("spotify:track:two"),
    ];
    playLibraryTrack(
      { uri: "spotify:track:two" },
      { playUri, playContext },
      { uri: "spotify:artist:kavinsky", tracks: popular },
      "librespot",
    );
    expect(playContext).toHaveBeenCalledWith(
      "spotify:artist:kavinsky",
      "spotify:track:two",
      popular,
    );
    expect(playUri).not.toHaveBeenCalled();
  });

  it("falls back to the album when no list context exists", () => {
    const playUri = vi.fn();
    const playContext = vi.fn();
    playLibraryTrack(
      { uri: "spotify:track:nightcall", albumUri: "spotify:album:outrun" },
      { playUri, playContext },
      undefined,
      "librespot",
    );
    expect(playContext).toHaveBeenCalledWith(
      "spotify:album:outrun",
      "spotify:track:nightcall",
    );
    expect(playUri).not.toHaveBeenCalled();
  });

  it("starts an artist or album with the visible catalog", () => {
    const playUri = vi.fn();
    const popular = [track("spotify:track:one"), track("spotify:track:two")];
    playLibraryContext("spotify:artist:kavinsky", popular, { playUri }, "librespot");
    expect(playUri).toHaveBeenCalledWith("spotify:artist:kavinsky", popular);
  });

  it("keeps the desktop engine on simple playUri and album playContext", () => {
    const playUri = vi.fn();
    const playContext = vi.fn();
    playLibraryTrack(
      { uri: "spotify:track:two" },
      { playUri, playContext },
      { uri: "spotify:artist:kavinsky", tracks: [track("spotify:track:two")] },
    );
    expect(playUri).toHaveBeenCalledWith("spotify:track:two");
    expect(playContext).not.toHaveBeenCalled();

    playUri.mockClear();
    playLibraryTrack(
      { uri: "spotify:track:nightcall", albumUri: "spotify:album:outrun" },
      { playUri, playContext },
      { uri: "spotify:album:outrun", tracks: [track("spotify:track:nightcall")] },
    );
    expect(playContext).toHaveBeenCalledWith(
      "spotify:album:outrun",
      "spotify:track:nightcall",
    );
    expect(playUri).not.toHaveBeenCalled();

    playLibraryContext("spotify:artist:kavinsky", [track("spotify:track:one")], { playUri });
    expect(playUri).toHaveBeenCalledWith("spotify:artist:kavinsky");
  });
});
