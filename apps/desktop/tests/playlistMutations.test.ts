import type { MediaItem, PlaylistDetails } from "@luft/protocol-types";
import { describe, expect, it } from "vitest";
import {
  matchesPlaylistSnapshotQuery,
  withAddedPlaylistTrack,
  withoutPlaylistTrack,
  withoutPlaylistUri,
} from "../src/features/entities/playlistMutations";

const track = (uri: string): MediaItem => ({
  uri: `spotify:track:${uri}`,
  source: "spotify",
  itemType: "track",
  title: uri,
  creators: [],
  explicit: false,
  playable: true,
});

const snapshot = (tracks: MediaItem[]): PlaylistDetails => ({
  uri: "spotify:playlist:night",
  name: "Night",
  tracks,
  offset: 0,
  limit: tracks.length,
  total: tracks.length,
  hasMore: false,
});

describe("playlist mutations", () => {
  it("prepends an added track with a timestamp", () => {
    const updated = withAddedPlaylistTrack(snapshot([track("one")]), track("two"));
    expect(updated.tracks[0]?.uri).toBe("spotify:track:two");
    expect(updated.tracks[0]?.addedAt).toBeTruthy();
    expect(updated.total).toBe(2);
  });

  it("does not prepend the same track twice", () => {
    const once = withAddedPlaylistTrack(snapshot([track("one")]), track("two"));
    const twice = withAddedPlaylistTrack(once, track("two"));
    expect(twice.tracks.map((item) => item.uri)).toEqual([
      "spotify:track:two",
      "spotify:track:one",
    ]);
    expect(twice.total).toBe(2);
  });

  it("removes a playlist row by entry id or first matching uri", () => {
    const withIds = snapshot([
      { ...track("one"), playlistEntryId: "uid-a" },
      { ...track("two"), playlistEntryId: "uid-b" },
    ]);
    expect(
      withoutPlaylistTrack(withIds, {
        uri: "spotify:track:two",
        playlistEntryId: "uid-b",
      }).tracks.map((item) => item.uri),
    ).toEqual(["spotify:track:one"]);

    const withoutIds = snapshot([track("one"), track("two"), track("one")]);
    expect(
      withoutPlaylistTrack(withoutIds, {
        uri: "spotify:track:one",
      }).tracks.map((item) => item.uri),
    ).toEqual(["spotify:track:two", "spotify:track:one"]);
  });

  it("matches live and cache snapshot queries for a playlist", () => {
    expect(
      matchesPlaylistSnapshotQuery(
        ["playlist-snapshot", "librespot", "spotify:playlist:night", "bridge-pending"],
        "spotify:playlist:night",
      ),
    ).toBe(true);
    expect(
      matchesPlaylistSnapshotQuery(
        ["playlist-snapshot-cache", "spotify:playlist:night"],
        "spotify:playlist:night",
      ),
    ).toBe(true);
    expect(
      matchesPlaylistSnapshotQuery(
        ["playlist-snapshot", "spotify:playlist:night"],
        "spotify:playlist:other",
      ),
    ).toBe(false);
  });
  it("drops every occurrence when the remote delete is URI based", () => {
    const next = withoutPlaylistUri(snapshot([track("a"), track("b"), track("a")]), "spotify:track:a");
    expect(next.tracks.map((item) => item.uri)).toEqual(["spotify:track:b"]);
    expect(next.total).toBe(1);
  });
});
