import type { DailyListeningActivity } from "../analytics/analyticsTypes";
import { peakDaypart } from "../analytics/peakDaypart";
import type { ListeningRecap, RecapPeriod } from "./recapTypes";

const DAY_MS = 86_400_000;
/** Discoveries only count once the history is older than this. */
const DISCOVERY_WARMUP_MS = 14 * DAY_MS;

export type RecapSlideId =
  | "intro"
  | "time"
  | "topTrack"
  | "topTracks"
  | "topArtist"
  | "discoveries"
  | "onRepeat"
  | "rhythm"
  | "places"
  | "summary";

export type Daypart = "night" | "morning" | "noon" | "afternoon" | "evening" | "late";
export type Taste = "explorer" | "loyal" | "balanced";

export interface RecapFacts {
  /** Change against the period before, -1 … ∞; absent without one. */
  change?: number;
  activeDays: number;
  periodDays: number;
  longestStreak: number;
  busiestDay?: DailyListeningActivity;
  daypart?: Daypart;
  peakHour?: number;
  taste: Taste;
  /** Share of all listening that went to the top artist. */
  topArtistShare?: number;
}

export function recapFacts(recap: ListeningRecap, period: RecapPeriod): RecapFacts {
  const overview = recap.overview;
  const days = overview.dailyActivity.filter((day) => day.listeningMs > 0);
  const previous = recap.previousListeningMs ?? undefined;
  const plays = Math.max(1, overview.qualifiedPlayCount);
  const variety = overview.uniqueTrackCount / plays;
  const peak = peakDaypart(overview.hourlyActivity ?? []);
  const busiestDay = days.reduce<DailyListeningActivity | undefined>(
    (best, day) => (!best || day.listeningMs > best.listeningMs ? day : best), undefined);
  const topArtist = overview.topArtists[0];
  const periodDays = Math.max(1, Math.round((period.toMs - period.fromMs) / DAY_MS));
  return {
    ...(previous && previous > 0 ? { change: overview.totalListeningMs / previous - 1 } : {}),
    activeDays: Math.min(days.length, periodDays),
    periodDays,
    longestStreak: longestStreak(days),
    ...(busiestDay ? { busiestDay } : {}),
    ...(peak ? { daypart: peak.daypart, peakHour: peak.hour } : {}),
    taste: variety >= 0.68 ? "explorer" : variety <= 0.34 ? "loyal" : "balanced",
    ...(topArtist && overview.totalListeningMs > 0
      ? { topArtistShare: Math.min(1, topArtist.listeningMs / overview.totalListeningMs) }
      : {}),
  };
}

/** Consecutive calendar days with listening. */
export function longestStreak(days: DailyListeningActivity[]): number {
  const sorted = days.map((day) => day.dayStartMs).sort((a, b) => a - b);
  let best = 0;
  let current = 0;
  let previous: number | undefined;
  for (const start of sorted) {
    // A daylight-saving day is 23 or 25 hours long.
    current = previous !== undefined && start - previous <= DAY_MS + 2 * 3_600_000 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = start;
  }
  return best;
}

/** The slides this recap has material for, in story order. */
export function recapSlides(recap: ListeningRecap, period: RecapPeriod, facts: RecapFacts): RecapSlideId[] {
  const overview = recap.overview;
  const slides: RecapSlideId[] = ["intro", "time"];
  if (overview.topTracks[0]) slides.push("topTrack");
  if (overview.topTracks.length >= 3) slides.push("topTracks");
  if (overview.topArtists[0]) slides.push("topArtist");
  const historyAge = recap.historyStartedAtMs != null ? period.fromMs - recap.historyStartedAtMs : 0;
  if (period.kind !== "milestone" && recap.newArtistCount > 0 && historyAge >= DISCOVERY_WARMUP_MS) {
    slides.push("discoveries");
  }
  if (recap.onRepeat) slides.push("onRepeat");
  if (facts.daypart || facts.longestStreak >= 2) slides.push("rhythm");
  if (overview.topPlaylists[0] || recap.topAlbum) slides.push("places");
  slides.push("summary");
  return slides;
}
