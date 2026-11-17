import type { DailyListeningActivity, HourlyListeningActivity } from "../analytics/analyticsTypes";
import type { RecapPeriod } from "./recapTypes";

const DAY_MS = 86_400_000;

export type RecapBarUnit = "day" | "week" | "month";

export interface RecapBar {
  /** Listening time in the bucket. */
  value: number;
  /** Axis label; empty where the axis stays quiet. */
  label: string;
  /** Start of the bucket, for the peak text. */
  startMs: number;
}

export interface RecapActivity {
  unit: RecapBarUnit;
  bars: RecapBar[];
  /** Index of the busiest bucket, -1 when nothing was heard. */
  peak: number;
}

/**
 * Listening over the period as bars: per day up to a month, per week up to
 * a season, per month beyond. Days without listening stay in as empty bars
 * so the rhythm (and the gaps) are visible.
 */
export function recapActivity(daily: DailyListeningActivity[], period: RecapPeriod, locale: string): RecapActivity {
  const days = Math.max(1, Math.round((period.toMs - period.fromMs) / DAY_MS));
  const unit: RecapBarUnit = days <= 31 ? "day" : days <= 120 ? "week" : "month";
  const bars = unit === "month" ? monthBars(daily, period, locale) : spanBars(daily, period, days, unit, locale);
  let peak = -1;
  bars.forEach((bar, index) => {
    if (bar.value > 0 && (peak < 0 || bar.value > bars[peak]!.value)) peak = index;
  });
  return { unit, bars, peak };
}

function spanBars(
  daily: DailyListeningActivity[],
  period: RecapPeriod,
  days: number,
  unit: "day" | "week",
  locale: string,
): RecapBar[] {
  const span = unit === "day" ? DAY_MS : 7 * DAY_MS;
  const count = unit === "day" ? days : Math.ceil(days / 7);
  const bars: RecapBar[] = Array.from({ length: count }, (_, index) => ({
    value: 0,
    label: "",
    startMs: period.fromMs + index * span,
  }));
  for (const day of daily) {
    // Rounded, not floored: a daylight-saving day is 23 or 25 hours long.
    const index = unit === "day"
      ? Math.round((day.dayStartMs - period.fromMs) / DAY_MS)
      : Math.floor((day.dayStartMs - period.fromMs + DAY_MS / 2) / span);
    const bar = bars[index];
    if (bar) bar.value += day.listeningMs;
  }
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" });
  bars.forEach((bar, index) => {
    if (unit === "day" && count <= 7) bar.label = weekday.format(bar.startMs).replace(".", "");
    else if (unit === "day") bar.label = index % 7 === 0 ? dayMonth.format(bar.startMs) : "";
    else bar.label = index % 2 === 0 ? dayMonth.format(bar.startMs) : "";
  });
  return bars;
}

function monthBars(daily: DailyListeningActivity[], period: RecapPeriod, locale: string): RecapBar[] {
  const bars: RecapBar[] = [];
  const format = new Intl.DateTimeFormat(locale, { month: "narrow" });
  const cursor = new Date(period.fromMs);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  const keyOf = (date: Date) => date.getFullYear() * 12 + date.getMonth();
  const index = new Map<number, RecapBar>();
  while (cursor.getTime() < period.toMs) {
    const bar = { value: 0, label: format.format(cursor), startMs: cursor.getTime() };
    bars.push(bar);
    index.set(keyOf(cursor), bar);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const day of daily) {
    const bar = index.get(keyOf(new Date(day.dayStartMs)));
    if (bar) bar.value += day.listeningMs;
  }
  return bars;
}

/** Listening per local hour, 0 … 23. */
export function recapHours(hourly: HourlyListeningActivity[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const entry of hourly) {
    if (entry.hour >= 0 && entry.hour < 24) hours[entry.hour] = (hours[entry.hour] ?? 0) + entry.listeningMs;
  }
  return hours;
}
