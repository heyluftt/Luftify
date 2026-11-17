import { expect, it } from "vitest";
import { selectDiscovery, type ScoredPick } from "../src/features/discovery/discoverySelection";

it("keeps stable ties and diversity rules while reading each candidate score once per round", () => {
  const reads = { count: 0 };
  const candidates: ScoredPick[] = Array.from({ length: 100 }, (_, index) => ({
    track: {
      uri: "spotify:track:" + index, title: String(index), source: "spotify",
      itemType: "track", creators: [{ name: "Artist " + index }],
      playable: true, explicit: false,
    },
    novel: true, sources: 1, artists: ["artist-" + index],
    get score() { reads.count++; return index % 5; },
  }));
  const picks = selectDiscovery(candidates);
  expect(picks.map(({ track }) => track.title)).toEqual(
    Array.from({ length: 20 }, (_, index) => String(4 + index * 5)),
  );
  // 100 + 99 + ... + 81: no repeated score computation inside a sorting comparator.
  expect(reads.count).toBe(1810);
  expect(candidates[0]!.track.title).toBe("0");
});

it("spreads four familiar-artist bridges through a mix of new artists", () => {
  const pick = (index: number, novel: boolean): ScoredPick => ({
    track: {
      uri: "spotify:track:" + index, title: String(index), source: "spotify",
      itemType: "track", creators: [{ name: "Artist " + index }], playable: true, explicit: false,
    },
    novel, sources: 1, artists: ["artist-" + index], score: novel ? 10 : 1,
  });
  const picks = selectDiscovery([
    ...Array.from({ length: 30 }, (_, index) => pick(index, true)),
    ...Array.from({ length: 10 }, (_, index) => pick(100 + index, false)),
  ]);
  expect(picks).toHaveLength(20);
  expect(picks.flatMap((item, index) => item.novel ? [] : [index])).toEqual([2, 7, 12, 17]);
});
