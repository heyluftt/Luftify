import { appLanguage, t } from "../../../i18n";
import type { AnalyticsRangeKey, ListeningOverview } from "../analyticsTypes";

/** The range written out under the title: "1. – 2. Oktober 2026", "Seit 8. August 2025" … */
export function rangeDates(rangeKey: AnalyticsRangeKey, overview: ListeningOverview): string {
  const long = new Intl.DateTimeFormat(appLanguage(), { day: "numeric", month: "long", year: "numeric" });
  const to = new Date(overview.toUnixMs);
  if (rangeKey === "today") return new Intl.DateTimeFormat(appLanguage(), { weekday: "long", day: "numeric", month: "long" }).format(to);
  if (rangeKey === "all") {
    const first = overview.dailyActivity.reduce((min, day) => Math.min(min, day.dayStartMs), Number.POSITIVE_INFINITY);
    return Number.isFinite(first) ? t("analytics.since", { date: long.format(new Date(first)) }) : "";
  }
  return long.formatRange(new Date(overview.fromUnixMs), to);
}
