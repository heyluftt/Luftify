import { expect, it, vi } from "vitest";
import { collectDiscoverySources } from "../src/features/discovery/collectDiscoverySources";
import { discoverySources } from "../src/features/discovery/discoverySources";
import { desktopApi } from "../src/services/desktopApi";

vi.mock("../src/services/desktopApi", () => ({ desktopApi: {
  search: vi.fn(), playlist: vi.fn(), artist: vi.fn(),
} }));

it("reaches later seeds before earlier searches exhaust the playlist budget", async () => {
  vi.mocked(desktopApi.search).mockImplementation(async ({ query }) => ({
    playlists: Array.from({ length: 4 }, (_, i) => ({ uri: `${query}/${i}` })),
  } as Awaited<ReturnType<typeof desktopApi.search>>));
  vi.mocked(desktopApi.playlist).mockResolvedValue({ tracks: [] } as unknown as Awaited<ReturnType<typeof desktopApi.playlist>>);
  const sources = discoverySources(new AbortController().signal);
  const seeds = Array.from({ length: 8 }, (_, i) => ({ creator: { name: `Seed${i}` }, completedCount: 1 }));
  await collectDiscoverySources(seeds, sources.collect, () => false);
  const uris = vi.mocked(desktopApi.playlist).mock.calls.map(([uri]) => uri);
  expect(uris.slice(0, 8)).toEqual(seeds.map(({ creator }) => `${creator.name}/0`));
  expect(uris).toHaveLength(12);
  expect(new Set(uris).size).toBe(12);
  expect(desktopApi.search).toHaveBeenCalledTimes(8);
});

it("stops after the first four taste lanes when the mix is full", async () => {
  const collect = vi.fn().mockResolvedValue(undefined);
  const seeds = Array.from({ length: 8 }, (_, i) => ({ creator: { name: String(i) }, completedCount: 1 }));
  await collectDiscoverySources(seeds, collect, () => true);
  expect(collect).toHaveBeenCalledTimes(4);
});

it("processes shared playlists once per seed and retains the strongest source weight", async () => {
  vi.resetAllMocks();
  const tracks = ["First", "Second", "New"].map((name) => ({
    uri: "spotify:track:" + name, title: name, source: "spotify" as const,
    itemType: "track" as const, creators: [{ name }], playable: true, explicit: false,
  }));
  vi.mocked(desktopApi.search).mockResolvedValue({
    playlists: [{ uri: "shared" }],
  } as Awaited<ReturnType<typeof desktopApi.search>>);
  vi.mocked(desktopApi.playlist).mockResolvedValue({
    tracks,
  } as Awaited<ReturnType<typeof desktopApi.playlist>>);
  const sources = discoverySources(new AbortController().signal);
  const first = { creator: { name: "First" }, completedCount: 0 };
  const second = { creator: { name: "Second" }, completedCount: 8 };
  await sources.collect(first, 1);
  const scan = vi.spyOn(tracks, "some");
  await sources.collect(first, 4);
  expect(scan).not.toHaveBeenCalled();
  await sources.collect(second, 1);
  await sources.collect(second, 4);
  expect(scan).toHaveBeenCalledTimes(1);
  scan.mockRestore();
  expect(sources.candidates).toHaveLength(3);
  expect(sources.candidates.every((candidate) => candidate.weight === 4)).toBe(true);
  expect(desktopApi.playlist).toHaveBeenCalledTimes(1);
  expect(desktopApi.search).toHaveBeenCalledTimes(2);
});
