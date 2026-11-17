import type { HourlyListeningActivity } from "./analyticsTypes";

export type Daypart = "night" | "morning" | "noon" | "afternoon" | "evening" | "late";

const DAYPARTS: ReadonlyArray<{ daypart: Daypart; from: number; to: number }> = [
  { daypart: "night", from: 0, to: 5 },
  { daypart: "morning", from: 5, to: 11 },
  { daypart: "noon", from: 11, to: 14 },
  { daypart: "afternoon", from: 14, to: 18 },
  { daypart: "evening", from: 18, to: 22 },
  { daypart: "late", from: 22, to: 24 },
];

/** The part of the day with the most listening per hour, and its busiest hour. */
export function peakDaypart(
  hourly: HourlyListeningActivity[],
): { daypart: Daypart; hour: number } | undefined {
  const byHour = new Array<number>(24).fill(0);
  for (const entry of hourly) {
    if (entry.hour >= 0 && entry.hour < 24) byHour[entry.hour] = (byHour[entry.hour] ?? 0) + entry.listeningMs;
  }
  if (byHour.every((value) => value <= 0)) return undefined;
  // Per hour, so the short noon window is not outweighed by the long morning.
  const scored = DAYPARTS.map((part) => {
    const hours = byHour.slice(part.from, part.to);
    return { part, average: hours.reduce((sum, value) => sum + value, 0) / hours.length };
  });
  const best = scored.reduce((top, entry) => (entry.average > top.average ? entry : top));
  let hour = best.part.from;
  for (let candidate = best.part.from; candidate < best.part.to; candidate += 1) {
    if (byHour[candidate]! > byHour[hour]!) hour = candidate;
  }
  return { daypart: best.part.daypart, hour };
}
