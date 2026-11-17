import { describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@luft/protocol-types";
import type { ListeningOverview } from "../src/features/analytics/analyticsTypes";
import { rankDiscovery } from "../src/features/discovery/discoveryRanking";
import { generateDiscovery } from "../src/features/discovery/discoveryService";
import { readDiscoveryLibrary } from "../src/features/discovery/discoveryLibrary";
import { desktopApi } from "../src/services/desktopApi";

vi.mock("../src/services/desktopApi", () => ({ desktopApi: {
  getListeningOverview: vi.fn(), artist: vi.fn(), search: vi.fn(), playlist: vi.fn(),
  cachedLikedTracks: vi.fn(), cachedPlaylists: vi.fn(), cachedPlaylistSnapshot: vi.fn(),
} }));
const track = (id: string, name: string): MediaItem => ({
  uri: `spotify:track:${id}`, title: id, source: "spotify", itemType: "track",
  creators: [{ name }], playable: true, explicit: false,
});
const stats = { listeningMs: 100000, sessionCount: 8, playCount: 8, completedCount: 8, lastPlayedAtMs: 1 };
const profile: ListeningOverview = {
  fromUnixMs: 0, toUnixMs: 1, totalListeningMs: 100000, sessionCount: 8,
  qualifiedPlayCount: 8, completedPlayCount: 8, uniqueTrackCount: 1,
  uniqueArtistCount: 1, uniquePlaylistCount: 0, topPlaylists: [], dailyActivity: [],
  behavior: { averageSessionMs: 10000, longestSessionMs: 10000, skipCount: 0,
    seekCount: 0, pauseCount: 0, repeatCount: 0, activeDayCount: 1, completionRate: 1 },
  topArtists: [{ ...stats, creator: { name: "Known", uri: "spotify:artist:known" } }],
  topTracks: [{ ...stats, track: track("heard", "Known") }],
};
const candidate = (id: string, name: string, source = "playlist") => ({ track: track(id, name), source, weight: 2 });

describe("discovery ranking", () => {
  it("uses cached discovery playlists but excludes owned and liked tracks without remote reads", async () => {
    vi.resetAllMocks();
    vi.mocked(desktopApi.cachedLikedTracks).mockResolvedValue({ items: [track("liked", "Known")] } as Awaited<ReturnType<typeof desktopApi.cachedLikedTracks>>);
    vi.mocked(desktopApi.cachedPlaylists).mockResolvedValue({ items: [
      { uri: "mine", name: "Release Radar", canModify: true },
      { uri: "weekly", name: "Discover Weekly", canModify: false },
      { uri: "repeat", name: "On Repeat", canModify: false },
    ] } as Awaited<ReturnType<typeof desktopApi.cachedPlaylists>>);
    vi.mocked(desktopApi.cachedPlaylistSnapshot).mockImplementation(async (uri) => ({
      tracks: [track(uri === "mine" ? "owned" : "new", "Artist")],
    } as Awaited<ReturnType<typeof desktopApi.cachedPlaylistSnapshot>>));
    const result = await readDiscoveryLibrary(new AbortController().signal);
    expect([...result.excluded]).toEqual(["spotify:track:liked", "spotify:track:owned"]);
    expect(result.candidates.map(({ track }) => track.uri)).toEqual(["spotify:track:new"]);
    expect(desktopApi.cachedPlaylistSnapshot).toHaveBeenCalledTimes(2);
    expect(desktopApi.playlist).not.toHaveBeenCalled();
    expect(desktopApi.search).not.toHaveBeenCalled();
  });
  it("broadens beyond three seeds when the initial sources cannot fill a mix", async () => {
    vi.resetAllMocks();
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      vi.mocked(desktopApi.getListeningOverview).mockResolvedValue({ ...profile,
        topArtists: ["First", "Second", "Third", "Fourth", "Fifth"].map((name) => ({ ...stats, creator: { name } })),
      });
      vi.mocked(desktopApi.search).mockImplementation(async ({ query }) => ({
        playlists: [{ uri: query }],
      } as Awaited<ReturnType<typeof desktopApi.search>>));
      vi.mocked(desktopApi.playlist).mockImplementation(async (uri) => ({
        tracks: uri === "Fourth" ? [track("seed", "Fourth"),
          ...Array.from({ length: 20 }, (_, index) => track(`fresh-${index}`, `Artist ${index}`))] : [],
      } as Awaited<ReturnType<typeof desktopApi.playlist>>));
      const result = await generateDiscovery(new AbortController().signal);
      expect(result.picks).toHaveLength(20);
      expect(desktopApi.search).toHaveBeenCalledTimes(4);
      expect(desktopApi.playlist).toHaveBeenCalledTimes(4);
    } finally { random.mockRestore(); }
  });
  it("tries deeper search hits without repeatedly fetching the first playlists", async () => {
    vi.resetAllMocks();
    vi.mocked(desktopApi.getListeningOverview).mockResolvedValue({ ...profile,
      topArtists: [{ ...stats, creator: { name: "Known" } }],
    });
    vi.mocked(desktopApi.search).mockResolvedValue({ playlists: [{ uri: "one" }, { uri: "two" }, { uri: "three" }] } as Awaited<ReturnType<typeof desktopApi.search>>);
    vi.mocked(desktopApi.playlist).mockImplementation(async (uri) => ({
      tracks: uri === "three" ? [track("heard", "Known"), ...Array.from({ length: 20 }, (_, index) => track(`new-${index}`, `Fresh ${index}`))] : [],
    } as Awaited<ReturnType<typeof desktopApi.playlist>>));
    expect((await generateDiscovery(new AbortController().signal)).picks).toHaveLength(20);
    expect(desktopApi.search).toHaveBeenCalledTimes(1);
    expect(desktopApi.playlist).toHaveBeenCalledTimes(3);
  });
  it("rechecks a shared playlist against another seed without fetching it twice", async () => {
    vi.clearAllMocks();
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      vi.mocked(desktopApi.getListeningOverview).mockResolvedValue({ ...profile,
        topArtists: [{ ...stats, creator: { name: "First" } }, { ...stats, creator: { name: "Second" } }],
      });
      vi.mocked(desktopApi.search).mockResolvedValue({ playlists: [{ uri: "shared" }] } as Awaited<ReturnType<typeof desktopApi.search>>);
      vi.mocked(desktopApi.playlist).mockResolvedValue({ tracks: [track("seed", "Second"), track("discovery", "Fresh")] } as Awaited<ReturnType<typeof desktopApi.playlist>>);
      const result = await generateDiscovery(new AbortController().signal);
      expect(result.picks.map((pick) => pick.track.uri)).toContain("spotify:track:discovery");
      expect(desktopApi.playlist).toHaveBeenCalledTimes(1);
    } finally {
      random.mockRestore();
    }
  });
  it("excludes known tracks, merges duplicate sources and caps each artist", () => {
    const picks = rankDiscovery([
      candidate("heard", "Known"), candidate("a", "Fresh"), candidate("a", "Fresh"),
      candidate("b", "Fresh"), candidate("c", "Fresh"), candidate("d", "Other"),
    ], profile, new Set(), () => 0);
    expect(picks.map((pick) => pick.track.uri)).not.toContain("spotify:track:heard");
    expect(picks.filter((pick) => pick.track.creators[0]?.name === "Fresh")).toHaveLength(2);
    expect(picks.find((pick) => pick.track.uri === "spotify:track:a")?.sources).toBe(1);
  });
  it("prioritizes new artists and recognizes a familiar name without its URI", () => {
    const picks = rankDiscovery([candidate("familiar", "Known"), candidate("new", "Fresh")], profile);
    expect(picks.map((pick) => pick.novel)).toEqual([true, false]);
  });
  it("shares artist limits across URI and name-only metadata and spaces artists out", () => {
    const first = candidate("a", "Fresh");
    first.track.creators[0]!.uri = "spotify:artist:fresh";
    const picks = rankDiscovery([first, candidate("b", "Fresh"), candidate("c", "Fresh"),
      candidate("d", "Other")], profile, new Set(), () => 0);
    expect(picks.map((pick) => pick.track.title)).toEqual(["a", "d", "b"]);
  });
  it("downweights the previous mix without blacklisting unheard suggestions", () => {
    const previous = new Set(["spotify:track:a"]);
    const picks = rankDiscovery([candidate("a", "Fresh"), candidate("b", "Other")], profile, previous, () => 0);
    expect(picks.map((pick) => pick.track.title)).toEqual(["b", "a"]);
    expect(rankDiscovery([candidate("a", "Fresh")], profile, previous)).toHaveLength(1);
  });
  it("keeps recent mix tracks out when other unheard tracks can fill the mix", () => {
    const previous = new Set(["spotify:track:repeat"]);
    const picks = rankDiscovery([
      candidate("repeat", "Fresh"),
      ...Array.from({ length: 20 }, (_, index) => candidate(`n${index}`, `A${index}`)),
    ], profile, previous, () => 0);
    expect(picks.map((pick) => pick.track.uri)).not.toContain("spotify:track:repeat");
    expect(picks).toHaveLength(20);
  });
  it("rejects unverified playlists and keeps usable results when a source fails", async () => {
    vi.mocked(desktopApi.getListeningOverview).mockResolvedValueOnce(profile)
      .mockResolvedValueOnce({ ...profile, topTracks: [{ ...stats, track: track("recent", "Fresh") }] });
    vi.mocked(desktopApi.artist).mockRejectedValue(new Error("unavailable"));
    vi.mocked(desktopApi.search).mockResolvedValue({ playlists: [{ uri: "one" }, { uri: "two" }] } as Awaited<ReturnType<typeof desktopApi.search>>);
    vi.mocked(desktopApi.playlist).mockImplementation(async (uri) => ({
      tracks: uri === "one" ? [track("seed", "Known"), track("match", "Fresh"), track("recent", "Fresh")] : [track("unrelated", "Unrelated")],
    } as Awaited<ReturnType<typeof desktopApi.playlist>>));
    const result = await generateDiscovery(new AbortController().signal);
    expect(result.incomplete).toBe(true);
    expect(result.picks.map((pick) => pick.track.uri)).toContain("spotify:track:match");
    expect(result.picks.map((pick) => pick.track.uri)).not.toContain("spotify:track:unrelated");
    expect(result.picks.map((pick) => pick.track.uri)).not.toContain("spotify:track:recent");
  });
});

describe("discovery freshness regressions", () => {
  it("prefers a fresh track over repeating a suggestion to separate artists", () => {
    const previous = new Set(["spotify:track:repeat"]);
    const picks = rankDiscovery([
      { ...candidate("a1", "A"), weight: 20 },
      { ...candidate("a2", "A"), weight: 19 },
      candidate("repeat", "B"),
    ], profile, previous, () => 0);
    expect(picks.map(({ track }) => track.title)).toEqual(["a1", "a2", "repeat"]);
  });
  it("recognizes known artists with compatibility-normalized names", () => {
    const picks = rankDiscovery([candidate("familiar", "Ｋｎｏｗｎ")], profile, new Set(), () => 0);
    expect(picks[0]?.novel).toBe(false);
  });

  it("continues bounded collection when early sources only fill the previous mix", async () => {
    vi.resetAllMocks();
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      vi.mocked(desktopApi.getListeningOverview).mockResolvedValue({ ...profile,
        topArtists: ["First", "Second", "Third", "Fourth"].map((name) => ({ ...stats, creator: { name } })),
      });
      vi.mocked(desktopApi.search).mockImplementation(async ({ query }) => ({
        playlists: [{ uri: query }],
      } as Awaited<ReturnType<typeof desktopApi.search>>));
      const old = Array.from({ length: 20 }, (_, i) => track(`old-${i}`, `Old ${i}`));
      vi.mocked(desktopApi.playlist).mockImplementation(async (uri) => ({
        tracks: [track(`seed-${uri}`, uri), ...(uri === "Fourth"
          ? Array.from({ length: 20 }, (_, i) => track(`new-${i}`, `New ${i}`)) : old)],
      } as Awaited<ReturnType<typeof desktopApi.playlist>>));
      const previous = new Set([...old.map(({ uri }) => uri),
        ...["First", "Second", "Third"].map((name) => `spotify:track:seed-${name}`)]);
      const result = await generateDiscovery(new AbortController().signal, previous);
      expect(result.picks).toHaveLength(20);
      expect(result.picks.every(({ track }) => !previous.has(track.uri))).toBe(true);
      expect(desktopApi.search).toHaveBeenCalledTimes(4);
      expect(desktopApi.playlist).toHaveBeenCalledTimes(4);
    } finally { random.mockRestore(); }
  });
});