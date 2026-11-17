import type {
  AnalyticsRangeKey,
  DailyListeningActivity,
  HourlyListeningActivity,
} from "./analyticsTypes";

export type ActivityGranularity = "hour" | "day" | "week" | "month";

export interface ActivityBucket {
  key: string;
  /** Local start of the bucket in epoch ms, or the hour (0-23) for hours. */
  start: number;
  listeningMs: number;
}

const MILLIS_PER_DAY = 86_400_000;
/** More days than this read better as weeks or months than as hairlines. */
const MAX_DAILY_BARS = 100;

/** Today by hour, up to ~3 months by day, a year by week, longer by month. */
export function activityGranularity(
  rangeKey: AnalyticsRangeKey,
  dayCount: number,
): ActivityGranularity {
  if (rangeKey === "today") return "hour";
  if (dayCount <= MAX_DAILY_BARS) return "day";
  return dayCount <= 400 ? "week" : "month";
}

export function hourlyBuckets(hourly: HourlyListeningActivity[]): ActivityBucket[] {
  const byHour = new Map(hourly.map((entry) => [entry.hour, entry.listeningMs] as const));
  return Array.from({ length: 24 }, (_, hour) => ({
    key: `h${hour}`,
    start: hour,
    listeningMs: byHour.get(hour) ?? 0,
  }));
}

/**
 * Calendar buckets from the first to the last day of the range, including
 * silent ones, so gaps in listening stay visible.
 */
export function calendarBuckets(
  activity: DailyListeningActivity[],
  fromUnixMs: number,
  toUnixMs: number,
  timezoneOffsetMinutes: number,
  granularity: Exclude<ActivityGranularity, "hour">,
): ActivityBucket[] {
  if (activity.length === 0) return [];
  const offset = timezoneOffsetMinutes * 60_000;
  // "Local" timestamps: UTC fields of these read as local calendar fields.
  const toLocalDay = (value: number) => Math.floor((value + offset) / MILLIS_PER_DAY) * MILLIS_PER_DAY;
  const firstDay = toLocalDay(fromUnixMs > 0 ? fromUnixMs : Math.min(...activity.map((day) => day.dayStartMs)));
  const lastDay = toLocalDay(toUnixMs);
  if (lastDay < firstDay) return [];

  const bucketStart = (localDay: number) => {
    if (granularity === "day") return localDay;
    const date = new Date(localDay);
    if (granularity === "month") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const sinceMonday = (date.getUTCDay() + 6) % 7;
    return localDay - sinceMonday * MILLIS_PER_DAY;
  };

  const buckets = new Map<number, ActivityBucket>();
  for (let day = firstDay; day <= lastDay; day += MILLIS_PER_DAY) {
    const start = bucketStart(day);
    if (!buckets.has(start)) {
      buckets.set(start, { key: `${granularity}${start}`, start: start - offset, listeningMs: 0 });
    }
  }
  for (const day of activity) {
    const bucket = buckets.get(bucketStart(toLocalDay(day.dayStartMs)));
    if (bucket) bucket.listeningMs += day.listeningMs;
  }
  return [...buckets.values()];
}

export function countRangeDays(fromUnixMs: number, toUnixMs: number, activity: DailyListeningActivity[]): number {
  const from = fromUnixMs > 0 ? fromUnixMs : Math.min(toUnixMs, ...activity.map((day) => day.dayStartMs));
  return Math.max(1, Math.ceil((toUnixMs - from) / MILLIS_PER_DAY));
}
