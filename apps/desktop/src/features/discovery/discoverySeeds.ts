import type { MediaCreator } from "@luft/protocol-types";
import type { ArtistListeningStat } from "../analytics/analyticsTypes";

export type DiscoverySeed = Pick<ArtistListeningStat, "creator" | "completedCount">;

export interface SeedLanes {
  /** Current listening phase. Capped so one phase can't crowd out long-term taste. */
  recent?: ArtistListeningStat[];
  /** Artists the listener enjoyed in earlier mixes. */
  discovered?: MediaCreator[];
}

const SEED_COUNT = 8;
const RECENT_SEED_LIMIT = 2;
const DISCOVERED_SEED_LIMIT = 2;

// Interleave long-term favorites, mix discoveries, the current phase, library
// artists and the broader lifetime profile. A full candidate pool from one
// source must not prevent the other lanes loading.
export function selectDiscoverySeeds(
  profile: ArtistListeningStat[],
  library: MediaCreator[],
  random = Math.random,
  extra: SeedLanes = {},
): DiscoverySeed[] {
  const rotate = <T,>(items: T[]): T[] => {
    const offset = Math.floor(random() * items.length);
    return [...items.slice(offset), ...items.slice(0, offset)];
  };
  const named = <T extends { creator: MediaCreator }>(items: T[]) => items.filter((item) => item.creator.name.trim());
  const asSeeds = (creators: MediaCreator[]) => creators.map((creator) => ({ creator, completedCount: 0 }));
  const valid = named(profile);
  const lanes: { seeds: DiscoverySeed[]; limit: number }[] = [
    { seeds: rotate(valid.slice(0, 8)), limit: SEED_COUNT },
    { seeds: named(asSeeds(extra.discovered ?? [])), limit: DISCOVERED_SEED_LIMIT },
    { seeds: rotate(named(extra.recent ?? []).slice(0, 8)), limit: RECENT_SEED_LIMIT },
    { seeds: rotate(named(asSeeds(library))), limit: SEED_COUNT },
    { seeds: rotate(valid.slice(8)), limit: SEED_COUNT },
  ];
  const names = new Set<string>();
  const uris = new Set<string>();
  const taken = lanes.map(() => 0);
  const result: DiscoverySeed[] = [];
  const open = () => lanes.some((lane, index) => lane.seeds.length && taken[index]! < lane.limit);
  while (result.length < SEED_COUNT && open()) {
    lanes.forEach((lane, index) => {
      while (lane.seeds.length && result.length < SEED_COUNT && taken[index]! < lane.limit) {
        const seed = lane.seeds.shift()!;
        const name = seed.creator.name.normalize("NFKC").trim().toLowerCase();
        if (names.has(name) || (seed.creator.uri && uris.has(seed.creator.uri))) continue;
        names.add(name);
        if (seed.creator.uri) uris.add(seed.creator.uri);
        result.push(seed);
        taken[index] = taken[index]! + 1;
        break;
      }
    });
  }
  return result;
}
