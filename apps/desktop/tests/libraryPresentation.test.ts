import type { EntitySummary } from "@luft/protocol-types";
import { describe, expect, it } from "vitest";
import {
  filterPlaylists,
  formatPlaylistCount,
  formatTrackCount,
  isWritableLibraryPlaylist,
  playlistDetail,
  playlistOwnerGroup,
  sortPlaylists,
} from "../src/features/library/libraryPresentation";

const playlist = (name: string, subtitle?: string): EntitySummary => ({
  uri: `spotify:playlist:${name}`,
  name,
  ...(subtitle ? { subtitle } : {}),
});

describe("library presentation", () => {
  it("filters playlists by name and subtitle", () => {
    const items = [
      playlist("Nachtfahrt", "Eigene Playlist"),
      playlist("Morning Mix", "Spotify"),
      playlist("Favorites"),
    ];
    expect(filterPlaylists(items, "nacht").map((item) => item.name)).toEqual(["Nachtfahrt"]);
    expect(filterPlaylists(items, "spotify").map((item) => item.name)).toEqual(["Morning Mix"]);
    expect(filterPlaylists(items, "  ")).toHaveLength(3);
  });

  it("describes visible playlist counts while filtering", () => {
    expect(formatPlaylistCount(1, 1, false)).toBe("1 Playlist");
    expect(formatPlaylistCount(12, 12, false)).toBe("12 Playlists");
    expect(formatPlaylistCount(2, 12, true)).toBe("2 von 12 Playlists");
  });

  it("keeps the track count label short", () => {
    expect(formatTrackCount(0)).toBe("0 Titel");
    expect(formatTrackCount(184)).toBe("184 Titel");
  });

  it("sorts playlists by name without changing library order by default", () => {
    const items = [playlist("Zebra"), playlist("alpha"), playlist("Ähre")];
    expect(sortPlaylists(items, "library").map((item) => item.name)).toEqual([
      "Zebra",
      "alpha",
      "Ähre",
    ]);
    expect(sortPlaylists(items, "name-asc").map((item) => item.name)).toEqual([
      "Ähre",
      "alpha",
      "Zebra",
    ]);
    expect(sortPlaylists(items, "name-desc").map((item) => item.name)).toEqual([
      "Zebra",
      "alpha",
      "Ähre",
    ]);
  });

  it("treats own library playlists as writable when the flag is missing", () => {
    expect(isWritableLibraryPlaylist({ uri: "spotify:playlist:mine" })).toBe(true);
    expect(isWritableLibraryPlaylist({
      uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
    })).toBe(false);
    expect(isWritableLibraryPlaylist({
      uri: "spotify:playlist:mine",
      canModify: false,
    })).toBe(false);
  });

  it("groups by owner and sorts by library date or size", () => {
    const mine = { ...playlist("Laufen"), library: { owner: "me", trackCount: 12, addedAt: 300, folder: "Sport" } } satisfies EntitySummary;
    const weekly = { ...playlist("Weekly"), library: { owner: "spotify", trackCount: 30, addedAt: 100 } } satisfies EntitySummary;
    const friend = { ...playlist("Party"), canModify: true, library: { owner: "other" } } satisfies EntitySummary;
    const items = [weekly, friend, mine];

    expect(items.map(playlistOwnerGroup)).toEqual(["spotify", "followed", "mine"]);
    expect(sortPlaylists(items, "added").map((item) => item.name)).toEqual(["Laufen", "Weekly", "Party"]);
    expect(sortPlaylists(items, "size").map((item) => item.name)).toEqual(["Weekly", "Laufen", "Party"]);
    expect(playlistDetail(mine)).toBe("Von dir · 12 Titel");
    expect(filterPlaylists(items, "sport lauf").map((item) => item.name)).toEqual(["Laufen"]);
  });
});
