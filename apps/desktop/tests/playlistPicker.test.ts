import { expect, it, vi } from "vitest";
import { desktopApi } from "../src/services/desktopApi";
import { playlistsContainingTrack, rememberPlaylistPickerItems, streamPlaylistPages } from "../src/components/track-actions/playlistPicker";
import { QueryClient } from "@tanstack/react-query";
import { sortPlaylists } from "../src/features/library/libraryPresentation";

vi.mock("../src/services/desktopApi", () => ({
  desktopApi: { playlists: vi.fn(), cachedPlaylists: vi.fn() },
}));

it("requires explicit edit rights and ranks editable playlists by listening frequency", () => {
  const items = rememberPlaylistPickerItems([
    { uri: "spotify:playlist:unknown", name: "Unknown" },
    { uri: "spotify:playlist:denied", name: "Denied", canModify: false },
    { uri: "spotify:playlist:one", name: "One", canModify: true },
    { uri: "spotify:playlist:two", name: "Two", canModify: true },
  ], true);
  expect(sortPlaylists(items, "most-played", [
    { playlistUri: "spotify:playlist:two", playCount: 9, lastPlayedAt: 100 },
  ]).map(p => p.name)).toEqual(["Two", "One"]);
  expect(rememberPlaylistPickerItems([...items, { ...items[0]!, canModify: false }], true)
    .map(p => p.name)).toEqual(["Two"]);
});

it("advances over folder-only rootlist pages and stops loading when closed", async () => {
  vi.mocked(desktopApi.playlists).mockReset();
  vi.mocked(desktopApi.playlists)
    .mockResolvedValueOnce({ items: [], offset: 0, limit: 50, total: 120, hasMore: true })
    .mockResolvedValueOnce({ items: [{ uri: "spotify:playlist:mine", name: "Mine", canModify: true }], offset: 50, limit: 50, total: 120, hasMore: true });
  let disposed = false;
  await streamPlaylistPages(items => { if (items.length) disposed = true; }, true, () => disposed);
  expect(desktopApi.playlists).toHaveBeenCalledTimes(2);
  expect(desktopApi.playlists).toHaveBeenNthCalledWith(2, { offset: 50, limit: 50 });
  expect(desktopApi.cachedPlaylists).not.toHaveBeenCalled();
});

it("marks playlists whose cached snapshot already contains the track", () => {
  const client = new QueryClient();
  const details = (uri: string, trackUri: string) => ({
    uri, name: uri, offset: 0, limit: 1, total: 1, hasMore: false,
    tracks: [{ uri: trackUri, title: "T", source: "spotify" as const, itemType: "track" as const, creators: [], explicit: false, playable: true }],
  });
  client.setQueryData(["playlist-snapshot-cache", "spotify:playlist:a"], details("spotify:playlist:a", "spotify:track:x"));
  client.setQueryData(["playlist-snapshot", "librespot", "spotify:playlist:b", "v"], details("spotify:playlist:b", "spotify:track:y"));
  expect([...playlistsContainingTrack(client, "spotify:track:x")]).toEqual(["spotify:playlist:a"]);
});
