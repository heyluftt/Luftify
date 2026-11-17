import type { MediaItem, PlaylistDetails } from "@luft/protocol-types";
import { describe, expect, it } from "vitest";
import {
  isPlaylistTrackPlaceholder,
  mergePlaylistDates,
  preferPlaylistSnapshot,
  readyPlaylistTracks,
} from "../src/features/entities/playlistSnapshot";

const track = (uri: string, addedAt?: string): MediaItem => ({
  uri: `spotify:track:${uri}`,
  source: "spotify",
  itemType: "track",
  title: uri,
  creators: [],
  explicit: false,
  playable: true,
  ...(addedAt ? { addedAt } : {}),
});

const snapshot = (tracks: MediaItem[], hasMore = false): PlaylistDetails => ({
  uri: "spotify:playlist:luft",
  name: "luft",
  tracks,
  offset: 0,
  limit: tracks.length,
  total: tracks.length,
  hasMore,
});

describe("playlist snapshot preference", () => {
  it("keeps a complete cached playlist when the live refresh is truncated", () => {
    const cached = snapshot([track("a", "2026-08-19T08:00:00Z"), track("b", "2026-01-01T00:00:00Z")]);
    const live = snapshot([track("a")]);
    expect(preferPlaylistSnapshot(live, cached)?.tracks.map((item) => item.uri)).toEqual([
      "spotify:track:a",
      "spotify:track:b",
    ]);
  });

  it("fills missing added dates from the cached snapshot", () => {
    const cached = snapshot([track("a", "2026-08-19T08:00:00Z")]);
    const live = snapshot([track("a"), track("b", "2025-01-01T00:00:00Z")]);
    expect(mergePlaylistDates(live.tracks, cached.tracks)[0]?.addedAt).toBe(
      "2026-08-19T08:00:00Z",
    );
    expect(preferPlaylistSnapshot(live, cached)?.tracks[0]?.addedAt).toBe(
      "2026-08-19T08:00:00Z",
    );
  });

  it("prefers live data when the playlist reports more tracks than the cache", () => {
    const cached = snapshot([track("a"), track("b")]);
    const live = { ...snapshot([track("a"), track("b")], true), total: 8 };
    expect(preferPlaylistSnapshot(live, cached)?.total).toBe(8);
    expect(preferPlaylistSnapshot(live, cached)?.hasMore).toBe(true);
  });

  it("hides unresolved loading rows from the visible list", () => {
    const tracks = [
      { ...track("a"), title: "Nightcall" },
      { ...track("b"), title: "Titel wird geladen…" },
      { ...track("c"), title: "Pacific" },
    ];
    expect(readyPlaylistTracks(tracks).map((item) => item.title)).toEqual([
      "Nightcall",
      "Pacific",
    ]);
  });

  it("drops repeated playlist entry ids from the visible snapshot", () => {
    const live = snapshot([
      { ...track("a"), playlistEntryId: "entry-a" },
      { ...track("a"), playlistEntryId: "entry-a" },
      { ...track("b"), playlistEntryId: "entry-b" },
    ]);
    expect(preferPlaylistSnapshot(live, live)?.tracks.map((item) => item.uri)).toEqual([
      "spotify:track:a",
      "spotify:track:b",
    ]);
  });

  it("does not replace a fresh live date with an older cached date", () => {
    const cached = snapshot([track("a", "2026-07-28T08:00:00Z")]);
    const live = snapshot([track("a", "2026-08-19T08:00:00Z")]);
    expect(mergePlaylistDates(live.tracks, cached.tracks)[0]?.addedAt).toBe(
      "2026-08-19T08:00:00Z",
    );
  });
  it("keeps a real 22-letter single-word title but hides ID-shaped placeholders", () => {
    expect(isPlaylistTrackPlaceholder({ ...track("real"), title: "Weltuntergangsstimmung" })).toBe(false);
    expect(isPlaylistTrackPlaceholder({ ...track("id"), title: "3n3Ppam7vgaVa1iaRUc9Lp" })).toBe(true);
  });
});
