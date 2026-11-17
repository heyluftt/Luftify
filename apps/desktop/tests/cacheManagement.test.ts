import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFrontendCacheQueries,
  formatCacheSize,
} from "../src/features/settings/CacheManagement";
import {
  lyricsFallbackCacheKey,
  readLyricsFallback,
  rememberLyricsFallback,
} from "../src/features/lyrics/lyricsFallbackCache";

describe("frontend cache clearing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes every playlist cache family without clearing unrelated caches", () => {
    const client = populatedClient();
    clearFrontendCacheQueries(client, "playlists");

    expect(client.getQueryData(["library-cache", "playlists", 0, 50])).toBeUndefined();
    expect(client.getQueryData(["playlist-snapshot-cache", "spotify:playlist:one"])).toBeUndefined();
    expect(client.getQueryData(["playback-context-playlist-cache", "spotify:playlist:one"])).toBeUndefined();
    expect(client.getQueryData(["library-cache", "liked", 0, 50])).toBe("liked");
    expect(client.getQueryData(["cover", "https://i.scdn.co/image/one"])).toBe("cover");
  });

  it("removes lyrics, covers and all library caches for the all scope", () => {
    const client = populatedClient();
    const lyricsKey = lyricsFallbackCacheKey("spotify:track:missing");
    rememberLyricsFallback(lyricsKey, "not-found");
    clearFrontendCacheQueries(client, "all");
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(readLyricsFallback(lyricsKey)).toBeUndefined();
  });
});

describe("cache size formatting", () => {
  it("uses compact binary units with German number formatting", () => {
    expect(formatCacheSize(0)).toBe("0 B");
    expect(formatCacheSize(1_536)).toBe("1,5 KB");
    expect(formatCacheSize(10 * 1024 * 1024)).toBe("10 MB");
  });
});

function populatedClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(["lyrics", "spotify:track:one"], "lyrics");
  client.setQueryData(["library-cache", "playlists", 0, 50], "playlists");
  client.setQueryData(["library-cache", "liked", 0, 50], "liked");
  client.setQueryData(["playlist-snapshot-cache", "spotify:playlist:one"], "snapshot");
  client.setQueryData(["playback-context-playlist-cache", "spotify:playlist:one"], "context");
  client.setQueryData(["cover", "https://i.scdn.co/image/one"], "cover");
  return client;
}
