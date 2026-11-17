import type { SearchResult } from "@luft/protocol-types";
import { beforeEach, describe, expect, it } from "vitest";
import { categoryHasMore, combineSearchPages } from "../src/features/search/combineSearchPages";
import {
  clearSearchHistory,
  forgetSearchQuery,
  readSearchHistory,
  rememberSearchQuery,
} from "../src/features/search/searchHistory";
import { matchLibraryPlaylists, pickTopResult } from "../src/features/search/searchRanking";
import {
  normalizeSearchQuery,
  searchCounts,
} from "../src/features/search/searchTypes";

const page = (change: Partial<SearchResult>): SearchResult => ({
  query: "sewer",
  offset: 0,
  limit: 2,
  hasMore: false,
  tracks: [],
  artists: [],
  albums: [],
  playlists: [],
  unavailable: [],
  ...change,
});

describe("search result model", () => {
  beforeEach(clearSearchHistory);

  it("normalizes whitespace without changing the query words", () => {
    expect(normalizeSearchQuery("  sewer   person  ")).toBe("sewer person");
  });

  it("combines pages in stable order and removes duplicate URIs", () => {
    const combined = combineSearchPages([
      page({
        hasMore: true,
        tracks: [track("spotify:track:1"), track("spotify:track:2")],
        unavailable: ["search.playlists"],
      }),
      page({
        offset: 2,
        tracks: [track("spotify:track:2"), track("spotify:track:3")],
        unavailable: ["search.playlists", "search.albums"],
      }),
    ]);

    expect(combined?.tracks.map((item) => item.uri)).toEqual([
      "spotify:track:1",
      "spotify:track:2",
      "spotify:track:3",
    ]);
    expect(combined?.unavailable).toEqual([
      "search.playlists",
      "search.albums",
    ]);
    expect(combined?.hasMore).toBe(false);
    expect(searchCounts(combined).all).toBe(3);
  });

  it("keeps a short, deduplicated local query history", () => {
    rememberSearchQuery("sewer");
    rememberSearchQuery("bladee");
    rememberSearchQuery("sewer");

    expect(readSearchHistory()).toEqual(["sewer", "bladee"]);
    expect(forgetSearchQuery("sewer")).toEqual(["bladee"]);
  });

  it("keeps only the finished query while typing", () => {
    rememberSearchQuery("bladee");
    rememberSearchQuery("kan");
    rememberSearchQuery("kanye", "kan");

    expect(readSearchHistory()).toEqual(["kanye", "bladee"]);
  });

  it("prefers Spotify's top hit, then an exact name match", () => {
    const artist = { uri: "spotify:artist:k", name: "Kavinsky" };
    const data = page({ query: "kavinsky", tracks: [track("spotify:track:1")], artists: [artist] });

    expect(pickTopResult(data)).toEqual({ kind: "artists", entry: artist });
    expect(pickTopResult({ ...data, topResultUri: "spotify:track:1" })?.kind).toBe("tracks");
    expect(pickTopResult({ ...data, query: "nightcall" })?.kind).toBe("tracks");
  });

  it("matches own playlists by every word, ignoring case and accents", () => {
    const playlists = [
      { uri: "spotify:playlist:a", name: "Café Nächte" },
      { uri: "spotify:playlist:b", name: "Cafe Morgen" },
    ];

    expect(matchLibraryPlaylists(playlists, "nachte cafe").map((entry) => entry.uri)).toEqual(["spotify:playlist:a"]);
  });

  it("stops loading a kind once its part of the last page came back short", () => {
    const pages = [page({ hasMore: true, tracks: [track("spotify:track:1"), track("spotify:track:2")], artists: [{ uri: "spotify:artist:k", name: "K" }] })];

    expect(categoryHasMore(pages, "tracks")).toBe(true);
    expect(categoryHasMore(pages, "artists")).toBe(false);
  });
});

function track(uri: string) {
  return {
    uri,
    source: "spotify" as const,
    itemType: "track" as const,
    title: uri,
    creators: [],
    explicit: false,
    playable: true,
  };
}
