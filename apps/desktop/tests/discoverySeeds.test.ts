import { describe, expect, it } from "vitest";
import { selectDiscoverySeeds } from "../src/features/discovery/discoverySeeds";

const artist = (name: string) => ({ creator: { name }, completedCount: 10,
  playCount: 10, sessionCount: 10, listeningMs: 1000, lastPlayedAtMs: 1 });

describe("discovery seed diversity", () => {
  it("includes the broader profile and library in the first three requests", () => {
    const profile = Array.from({ length: 20 }, (_, i) => artist(`Artist ${i}`));
    const seeds = selectDiscoverySeeds(profile, [{ name: "Library artist" }], () => 0);
    expect(seeds.slice(0, 3).map((seed) => seed.creator.name)).toEqual(["Artist 0", "Library artist", "Artist 8"]);
    expect(seeds).toHaveLength(8);
  });
  it("caps the current phase and continues artists enjoyed in earlier mixes", () => {
    const profile = Array.from({ length: 20 }, (_, i) => artist(`Artist ${i}`));
    const recent = Array.from({ length: 6 }, (_, i) => artist(`Phase ${i}`));
    const seeds = selectDiscoverySeeds(profile, [], () => 0, { recent, discovered: [{ name: "Mix find" }] });
    const names = seeds.map((seed) => seed.creator.name);
    expect(names.slice(0, 3)).toEqual(["Artist 0", "Mix find", "Phase 0"]);
    expect(names.filter((name) => name.startsWith("Phase"))).toHaveLength(2);
    expect(seeds).toHaveLength(8);
  });
  it("deduplicates library artists and works without a listening profile", () => {
    const seeds = selectDiscoverySeeds([artist("Artist")], [{ name: " artist ", uri: "spotify:artist:a" }, { name: "Other" }], () => 0);
    expect(seeds.map((seed) => seed.creator.name)).toEqual(["Artist", "Other"]);
    expect(selectDiscoverySeeds([], [{ name: "Saved" }], () => 0)).toHaveLength(1);
  });
});
