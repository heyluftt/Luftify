import { t, type MessageKey } from "../../i18n";
import type {
  AnalyticsRange,
  AnalyticsRangeKey,
  AnalyticsRangeRequest,
} from "./analyticsTypes";

export const ANALYTICS_RANGES: ReadonlyArray<{
  key: AnalyticsRangeKey;
  labelKey: MessageKey;
}> = [
  { key: "today", labelKey: "analytics.range.today" },
  { key: "sevenDays", labelKey: "analytics.range.sevenDays" },
  { key: "thisMonth", labelKey: "analytics.range.thisMonth" },
  { key: "ninetyDays", labelKey: "analytics.range.ninetyDays" },
  { key: "thisYear", labelKey: "analytics.range.thisYear" },
  { key: "all", labelKey: "analytics.range.all" },
];

export const DEFAULT_ANALYTICS_RANGE: AnalyticsRangeKey = "thisMonth";

export function createAnalyticsRange(
  key: AnalyticsRangeKey,
  now = new Date(),
  limit = 10,
): AnalyticsRange {
  const descriptor = ANALYTICS_RANGES.find((range) => range.key === key)
    ?? ANALYTICS_RANGES.find((range) => range.key === DEFAULT_ANALYTICS_RANGE)!;
  return {
    key: descriptor.key,
    label: t(descriptor.labelKey),
    request: createAnalyticsRangeRequest(descriptor.key, now, limit),
  };
}

export function createAnalyticsRangeRequest(
  key: AnalyticsRangeKey,
  now = new Date(),
  limit = 10,
): AnalyticsRangeRequest {
  const end = now.getTime();
  let from = 0;

  if (key === "today") {
    from = localDayStart(now, 0).getTime();
  } else if (key === "sevenDays") {
    from = localDayStart(now, 6).getTime();
  } else if (key === "thisMonth") {
    from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  } else if (key === "ninetyDays") {
    from = localDayStart(now, 89).getTime();
  } else if (key === "thisYear") {
    from = new Date(now.getFullYear(), 0, 1).getTime();
  }

  return {
    fromUnixMs: from,
    toUnixMs: end,
    limit,
    timezoneOffsetMinutes: -now.getTimezoneOffset(),
  };
}

function localDayStart(date: Date, daysBack: number) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - daysBack,
  );
}

/**
 * The same stretch one period earlier, for "more than before": yesterday up
 * to this time, the 7 or 90 days before, last month or last year up to the
 * same day. "All" has nothing before it.
 */
export function previousAnalyticsRangeRequest(
  key: AnalyticsRangeKey,
  now = new Date(),
  limit = 10,
): AnalyticsRangeRequest | null {
  const current = createAnalyticsRangeRequest(key, now, limit);
  if (key === "all") return null;
  let from: Date;
  let to: Date;
  if (key === "thisMonth") {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sameDay = Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate());
    to = new Date(now.getFullYear(), now.getMonth() - 1, sameDay, now.getHours(), now.getMinutes());
  } else if (key === "thisYear") {
    from = new Date(now.getFullYear() - 1, 0, 1);
    to = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  } else {
    const span = current.toUnixMs - current.fromUnixMs;
    from = new Date(current.fromUnixMs - span);
    to = new Date(current.fromUnixMs);
  }
  return { ...current, fromUnixMs: from.getTime(), toUnixMs: to.getTime() };
}
