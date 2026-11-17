import type { ActivityGranularity } from "./activityBuckets";
import { appLanguage, t } from "../../i18n";

function locale() {
  return appLanguage() === "en" ? "en-US" : "de-DE";
}

function integerFormat() {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 });
}

export function formatCount(value: number) {
  return integerFormat().format(Math.max(0, value));
}

/** "1 Play", "27 Plays". */
export function formatPlays(value: number) {
  return value === 1 ? t("analytics.playCountOne") : t("analytics.playCount", { n: formatCount(value) });
}

export function formatListeningTime(valueMs: number) {
  const normalized = Math.max(0, valueMs);
  if (normalized > 0 && normalized < 60_000) return t("analytics.time.underMinute");

  const minutes = Math.floor(normalized / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return t("analytics.time.minutes", { n: minutes });
  if (remainder === 0) return t("analytics.time.hours", { n: integerFormat().format(hours) });
  return t("analytics.time.hoursMinutes", {
    n: integerFormat().format(hours),
    m: remainder,
  });
}

export function formatPercentage(value: number) {
  const normalized = value > 1 ? value : value * 100;
  const percent = Math.round(Math.max(0, Math.min(100, normalized)));
  return appLanguage() === "en" ? `${percent}%` : `${percent} %`;
}

/** Label of an activity bar: an hour, a day, a week or a month. */
export function formatActivityLabel(
  start: number,
  granularity: ActivityGranularity,
  timezoneOffsetMinutes: number,
) {
  if (granularity === "hour") {
    // German Intl pads the hour ("00 Uhr"); the plain form reads better.
    if (appLanguage() !== "en") return `${start} Uhr`;
    return new Intl.DateTimeFormat(locale(), { hour: "numeric", timeZone: "UTC" })
      .format(Date.UTC(2000, 0, 1, start));
  }
  const local = new Date(start + timezoneOffsetMinutes * 60_000);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale(), { ...options, timeZone: "UTC" }).format(local);
  if (granularity === "day") return format({ weekday: "short", day: "numeric", month: "short" });
  if (granularity === "week") return t("analytics.weekOf", { date: format({ day: "numeric", month: "short" }) });
  return format({ month: "short", year: "numeric" });
}

/** A local hour (0-23) as the locale writes it, e.g. "21 Uhr" or "9 PM". */
export function formatHour(hour: number) {
  return formatActivityLabel(hour, "hour", 0);
}

export function joinCreatorNames(
  creators: ReadonlyArray<{ name: string }>,
) {
  return creators.map((creator) => creator.name).filter(Boolean).join(", ")
    || t("player.unknownArtist");
}
