import { appLanguage } from "../../../i18n";

const relative = new Intl.RelativeTimeFormat(appLanguage(), { numeric: "auto", style: "short" });
const date = new Intl.DateTimeFormat(appLanguage(), { day: "numeric", month: "long", year: "numeric" });

/** "vor 5 Min.", "gestern" – for recently played tracks. */
export function playedAgo(ms: number, now = Date.now()): string {
  const minutes = Math.round((ms - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(Math.min(0, minutes), "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export const friendsSince = (ms: number) => date.format(ms);
