import type { MediaItem } from "@luft/protocol-types";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYLIST_SORT,
  formatAddedAt,
  readPlaylistSort,
  savePlaylistSort,
  sortPlaylistTracks,
  type PlaylistSort,
} from "../src/features/library/playlistSorting";

const track = (uri: string, title: string, addedAt?: string): MediaItem => ({
  uri,
  source: "spotify",
  itemType: "track",
  title,
  creators: [{ name: `${title} Artist` }],
  albumName: `${title} Album`,
  durationMs: title.length * 1_000,
  ...(addedAt ? { addedAt } : {}),
  explicit: false,
  playable: true,
});

describe("playlist sorting", () => {
  it("shows newly added tracks first by default", () => {
    const tracks = [
      track("spotify:track:old", "Old", "2025-01-01T00:00:00.000Z"),
      track("spotify:track:unknown", "Unknown"),
      track("spotify:track:new", "New", "2026-07-14T00:00:00.000Z"),
    ];
    expect(sortPlaylistTracks(tracks, DEFAULT_PLAYLIST_SORT).map((item) => item.title)).toEqual(["New", "Old", "Unknown"]);
  });

  it("recovers unix-second added dates that were stored as 1970 timestamps", () => {
    const tracks = [
      track("spotify:track:old", "Old", "2025-01-01T00:00:00.000Z"),
      track("spotify:track:new", "New", "1784025000"),
      track("spotify:track:epoch", "Epoch", "1970-01-21T15:33:45.000Z"),
    ];
    expect(sortPlaylistTracks(tracks, DEFAULT_PLAYLIST_SORT).map((item) => item.title)).toEqual([
      "New",
      "Epoch",
      "Old",
    ]);
  });

  it("keeps equal values stable and missing values at the end", () => {
    const tracks = [track("spotify:track:b", "Same"), track("spotify:track:a", "Same"), track("spotify:track:c", "Alpha")];
    const sorted = sortPlaylistTracks(tracks, { field: "title", direction: "desc" });
    expect(sorted.map((item) => item.uri)).toEqual(["spotify:track:b", "spotify:track:a", "spotify:track:c"]);
  });

  it("preserves and reverses the original playlist order explicitly", () => {
    const tracks = [track("spotify:track:1", "One"), track("spotify:track:2", "Two")];
    expect(sortPlaylistTracks(tracks, { field: "playlistOrder", direction: "asc" }).map((item) => item.title)).toEqual(["One", "Two"]);
    expect(sortPlaylistTracks(tracks, { field: "playlistOrder", direction: "desc" }).map((item) => item.title)).toEqual(["Two", "One"]);
  });

  it("stores the chosen sort per playlist and falls back safely", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const selected: PlaylistSort = { field: "album", direction: "asc" };
    savePlaylistSort("spotify:playlist:luft", selected, storage);
    expect(readPlaylistSort("spotify:playlist:luft", storage)).toEqual(selected);
    expect(readPlaylistSort("spotify:playlist:other", storage)).toEqual(DEFAULT_PLAYLIST_SORT);
  });

  it("formats recent added dates in compact German labels", () => {
    const now = new Date("2026-07-16T12:00:00+02:00");
    expect(formatAddedAt("2026-07-16T08:00:00+02:00", now)).toBe("Heute");
    expect(formatAddedAt("2026-07-15T08:00:00+02:00", now)).toBe("Gestern");
    expect(formatAddedAt(undefined, now)).toBe("—");
  });
});
