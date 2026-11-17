import type { MediaItem } from "@luft/protocol-types";
import { expect, it } from "vitest";
import { playlistPlaybackTracks } from "../src/features/library/playlistSorting";

const tracks: MediaItem[] = ["C", "A", "B"].map((title) => ({
  uri: `spotify:track:${title}`, title, creators: [], source: "spotify",
  itemType: "track", playable: true, explicit: false,
}));
const sort = { field: "title", direction: "asc" } as const;

it("passes the entire sorted playlist to playback without changing the source", () => {
  const ordered = playlistPlaybackTracks({ tracks, total: 3, hasMore: false }, sort);
  expect(ordered?.map((track) => track.title)).toEqual(["A", "B", "C"]);
  expect(tracks.map((track) => track.title)).toEqual(["C", "A", "B"]);
});

it("leaves incomplete playlists to the backend instead of truncating the queue", () => {
  expect(playlistPlaybackTracks({ tracks, total: 147, hasMore: false }, sort)).toBeUndefined();
  expect(playlistPlaybackTracks({ tracks, total: 3, hasMore: true }, sort)).toBeUndefined();
});
