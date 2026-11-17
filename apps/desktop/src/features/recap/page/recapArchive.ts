import type { DailyListeningActivity } from "../../analytics/analyticsTypes";
import { longestStreak } from "../recapPlan";
import type { RecapPeriod } from "../recapTypes";

const DAY_MS = 86_400_000;

/** One year on the recaps page: its look backs sorted into shelves. */
export interface RecapYear {
  year: number;
  yearRecap?: RecapPeriod;
  seasons: RecapPeriod[];
  milestones: RecapPeriod[];
  /** January … December; a month without its own recap is undefined. */
  months: (RecapPeriod | undefined)[];
  weeks: RecapPeriod[];
}

export interface YearStats {
  listeningMs: number;
  activeDays: number;
  longestStreak: number;
  busiestDay?: DailyListeningActivity;
  /** Listening per month, January first. */
  monthMs: number[];
}

/** Where a period belongs: the year its last day falls in. */
export function periodYear(period: RecapPeriod): number {
  return new Date(period.toMs - 1).getFullYear();
}

/** Days by the local calendar day they stand for (noon avoids daylight-saving edges). */
function dayDate(day: DailyListeningActivity): Date {
  return new Date(day.dayStartMs + DAY_MS / 2);
}

/** Every year with listening or a recap, newest first. */
export function recapYears(periods: RecapPeriod[], days: DailyListeningActivity[], now = new Date()): RecapYear[] {
  const years = new Set<number>([now.getFullYear()]);
  for (const day of days) if (day.listeningMs > 0) years.add(dayDate(day).getFullYear());
  for (const period of periods) years.add(periodYear(period));
  const firstListened = Math.min(...days.filter((day) => day.listeningMs > 0).map((day) => day.dayStartMs));
  return [...years]
    .filter((year) => year <= now.getFullYear() && (Number.isFinite(firstListened) ? year >= new Date(firstListened).getFullYear() : year === now.getFullYear()))
    .sort((a, b) => b - a)
    .map((year) => {
      const own = periods.filter((period) => periodYear(period) === year);
      const months: (RecapPeriod | undefined)[] = Array.from({ length: 12 }, () => undefined);
      for (const period of own) if (period.kind === "month") months[new Date(period.fromMs).getMonth()] = period;
      const yearRecap = own.find((period) => period.kind === "year");
      return {
        year,
        ...(yearRecap ? { yearRecap } : {}),
        seasons: own.filter((period) => period.kind === "season").sort((a, b) => a.fromMs - b.fromMs),
        milestones: own.filter((period) => period.kind === "milestone").sort((a, b) => a.toMs - b.toMs),
        months,
        weeks: own.filter((period) => period.kind === "week").sort((a, b) => b.fromMs - a.fromMs),
      };
    });
}

export function yearStats(days: DailyListeningActivity[], year: number): YearStats {
  const own = days.filter((day) => day.listeningMs > 0 && dayDate(day).getFullYear() === year);
  const monthMs = Array.from({ length: 12 }, () => 0);
  let listeningMs = 0;
  let busiestDay: DailyListeningActivity | undefined;
  for (const day of own) {
    listeningMs += day.listeningMs;
    monthMs[dayDate(day).getMonth()]! += day.listeningMs;
    if (!busiestDay || day.listeningMs > busiestDay.listeningMs) busiestDay = day;
  }
  return { listeningMs, activeDays: own.length, longestStreak: longestStreak(own), ...(busiestDay ? { busiestDay } : {}), monthMs };
}

export interface HeatCell {
  /** Local midnight of the day. */
  date: Date;
  listeningMs: number;
  /** 0 = nothing, 1–4 = quarters of this year's listening days. */
  level: 0 | 1 | 2 | 3 | 4;
  /** Outside the year (padding of the first and last week) or still to come. */
  outside: boolean;
  future: boolean;
}

/**
 * The year as weeks of seven days (Monday first), like a contribution
 * calendar. Levels split the listening days into quarters, so a quiet year
 * shows its own peaks too.
 */
export function heatmapWeeks(days: DailyListeningActivity[], year: number, now = new Date()): HeatCell[][] {
  const byDay = new Map<string, number>();
  for (const day of days) {
    const date = dayDate(day);
    if (date.getFullYear() === year && day.listeningMs > 0) byDay.set(key(date), (byDay.get(key(date)) ?? 0) + day.listeningMs);
  }
  const values = [...byDay.values()].sort((a, b) => a - b);
  const quartile = (share: number) => values[Math.min(values.length - 1, Math.floor(values.length * share))] ?? 0;
  const limits = [quartile(0.25), quartile(0.5), quartile(0.75)];
  const level = (value: number): HeatCell["level"] => {
    if (value <= 0) return 0;
    if (value <= limits[0]!) return 1;
    if (value <= limits[1]!) return 2;
    if (value <= limits[2]!) return 3;
    return 4;
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const first = new Date(year, 0, 1);
  const start = new Date(year, 0, 1 - ((first.getDay() + 6) % 7));
  const last = new Date(year, 11, 31);
  const weeks: HeatCell[][] = [];
  for (let monday = start; monday <= last; monday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7)) {
    weeks.push(Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset);
      const listeningMs = byDay.get(key(date)) ?? 0;
      return { date, listeningMs, level: level(listeningMs), outside: date.getFullYear() !== year, future: date > today };
    }));
  }
  return weeks;
}

/** The week recap a day belongs to, if there is one. */
export function weekOf(date: Date, weeks: RecapPeriod[]): RecapPeriod | undefined {
  const time = date.getTime() + DAY_MS / 2;
  return weeks.find((week) => time >= week.fromMs && time < week.toMs);
}

function key(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
