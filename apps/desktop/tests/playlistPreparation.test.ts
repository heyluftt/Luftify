import type { MediaItem, PlaylistDetails } from "@luft/protocol-types";
import { describe, expect, it, vi } from "vitest";
import { preparePlaylistAssets } from "../src/features/entities/playlistPreparation";

describe("preparePlaylistAssets", () => {
  it("continues an incomplete snapshot and caches each unique cover", async () => {
    const first = details([track("one", "https://covers/one")], 2, true);
    const complete = details([
      track("one", "https://covers/one"),
      track("two", "https://covers/two"),
    ], 2, false);
    const loadSnapshot = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(complete);
    const loadCover = vi.fn(async (_url: string) => undefined);
    const onProgress = vi.fn();

    const result = await preparePlaylistAssets("spotify:playlist:test", {
      loadSnapshot,
      loadCover,
      onProgress,
    });

    expect(result.snapshot.tracks).toHaveLength(2);
    expect(result.preparedTracks).toBe(2);
    expect(result.unavailableTracks).toBe(0);
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(loadCover.mock.calls.map(([url]) => url)).toEqual([
      "https://covers/one",
      "https://covers/two",
    ]);
    expect(onProgress).toHaveBeenLastCalledWith({ stage: "covers", completed: 2, total: 2 });
  });

  it("accepts a stable playable subset when local titles are unavailable", async () => {
    const available = Array.from({ length: 790 }, (_, index) => track(String(index)));
    const incomplete = details(available, 829, true);
    const loadSnapshot = vi.fn(async () => incomplete);

    const result = await preparePlaylistAssets("spotify:playlist:test", {
      loadSnapshot,
      loadCover: vi.fn(async (_url: string) => undefined),
    });

    expect(result.preparedTracks).toBe(790);
    expect(result.unavailableTracks).toBe(39);
    expect(loadSnapshot).toHaveBeenCalledTimes(4);
  });

  it("still fails when no playlist title can be prepared", async () => {
    const incomplete = details([], 2, true);
    const loadSnapshot = vi.fn(async () => incomplete);

    await expect(preparePlaylistAssets("spotify:playlist:test", {
      loadSnapshot,
      loadCover: vi.fn(async (_url: string) => undefined),
    })).rejects.toThrow("Keine Titeldaten");
    expect(loadSnapshot).toHaveBeenCalledTimes(4);
  });
});

function details(tracks: MediaItem[], total: number, hasMore: boolean): PlaylistDetails {
  return {
    uri: "spotify:playlist:test",
    name: "Test",
    tracks,
    offset: 0,
    limit: tracks.length,
    total,
    hasMore,
  };
}

function track(id: string, coverUri?: string): MediaItem {
  return {
    uri: `spotify:track:${id}`,
    source: "spotify",
    itemType: "track",
    title: `Track ${id}`,
    creators: [{ name: "Artist" }],
    ...(coverUri ? { coverUri } : {}),
    explicit: false,
    playable: true,
  };
}
