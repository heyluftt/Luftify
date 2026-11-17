import { appLanguage, t } from "../../../i18n";

/** "76 Std." or "45 Min.": a tile has room for one unit only. */
export function shortTime(listeningMs: number): string {
  const hours = Math.round(listeningMs / 3_600_000);
  if (hours >= 1) return t("analytics.time.hours", { n: new Intl.NumberFormat(appLanguage()).format(hours) });
  return t("analytics.time.minutes", { n: Math.max(1, Math.round(listeningMs / 60_000)) });
}

export function monthName(month: number, style: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat(appLanguage(), { month: style }).format(new Date(2026, month, 15)).replace(".", "");
}

export function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat(appLanguage(), { weekday: "short", day: "numeric", month: "long" }).format(date);
}
