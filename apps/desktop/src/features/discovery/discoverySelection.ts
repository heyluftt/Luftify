import type { DiscoveryPick } from "./discoveryRanking";

export interface ScoredPick extends DiscoveryPick { score: number; artists: string[] }

// Slots 3, 8, 13 and 18 of 20: four bridges, never two in a row.
const BRIDGE_INTERVAL = 5;
const BRIDGE_OFFSET = 2;

const prefer = <T,>(pool: T[], predicate: (item: T) => boolean): T[] => {
  const preferred = pool.filter(predicate);
  return preferred.length ? preferred : pool;
};

export function selectDiscovery(scored: ScoredPick[], previousTracks: ReadonlySet<string> = new Set()): DiscoveryPick[] {
  const remaining = [...scored];
  const counts = new Map<string, number>();
  const picks: DiscoveryPick[] = [];
  let previous: string[] = [];
  while (picks.length < 20) {
    const eligible = remaining.filter((pick) => pick.artists.every((artist) => (counts.get(artist) ?? 0) < 2));
    if (!eligible.length) break;
    const freshPool = prefer(eligible, (pick) => !previousTracks.has(pick.track.uri));
    // Spread a few unheard titles by familiar artists through the mix as
    // bridges; every other slot goes to new artists while any remain.
    const bridgeSlot = picks.length % BRIDGE_INTERVAL === BRIDGE_OFFSET;
    const lanePool = prefer(freshPool, (pick) => pick.novel !== bridgeSlot);
    const pool = prefer(lanePool, (pick) => !pick.artists.some((artist) => previous.includes(artist)));
    // Favor artists not yet represented without hard-excluding lower-ranked candidates.
    const diversityScore = (pick: ScoredPick) => pick.score - Math.max(...pick.artists.map((artist) => counts.get(artist) ?? 0)) * 3;
    // Only the winner is needed. Keep the original order on ties, as stable sort did.
    let next = pool[0]!;
    let bestScore = diversityScore(next);
    for (let index = 1; index < pool.length; index++) {
      const candidate = pool[index]!;
      const score = diversityScore(candidate);
      if (score > bestScore) {
        next = candidate;
        bestScore = score;
      }
    }

    picks.push({ track: next.track, novel: next.novel, sources: next.sources });
    remaining.splice(remaining.indexOf(next), 1);
    previous = next.artists;
    for (const artist of next.artists) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return picks;
}
