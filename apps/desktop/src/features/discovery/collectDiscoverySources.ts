import type { DiscoverySeed } from "./discoverySeeds";

// Give every seed a first playlist before spending the remaining budget on
// deeper hits. Always sample the first four taste lanes (long-term, mix
// discoveries, current phase, library), even for a full mix.
const GUARANTEED_SEEDS = 4;
export async function collectDiscoverySources(
  seeds: DiscoverySeed[],
  collect: (seed: DiscoverySeed, depth: number) => Promise<void>,
  enough: () => boolean | Promise<boolean>,
) {
  for (const seed of seeds.slice(0, GUARANTEED_SEEDS)) await collect(seed, 1);
  for (const seed of seeds.slice(GUARANTEED_SEEDS)) {
    if (await enough()) return;
    await collect(seed, 1);
  }
  for (let depth = 2; depth <= 4; depth++) {
    for (const seed of seeds) {
      if (await enough()) return;
      await collect(seed, depth);
    }
  }
}
