import { appLanguage, t, type MessageKey } from "../../i18n";
import { formatCount, formatHour } from "../analytics/analyticsFormatting";
import type { RecapFacts } from "./recapPlan";

function locale() {
  return appLanguage() === "en" ? "en-US" : "de-DE";
}

/** "Dienstag, 16. September" */
export function formatRecapDay(dayStartMs: number): string {
  return new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long" }).format(new Date(dayStartMs + 12 * 3_600_000));
}

/** "12. März 2026" */
export function formatRecapDate(ms: number): string {
  return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
}

/** Minutes below ten hours, hours above: "754 Minuten", "128 Stunden". */
export function recapAmount(listeningMs: number): { value: number; unit: string } {
  const minutes = Math.round(listeningMs / 60_000);
  if (minutes < 600) return { value: minutes, unit: t("recap.time.minutes") };
  return { value: Math.round(listeningMs / 3_600_000), unit: t("recap.time.hours") };
}

export function recapChangeText(change: number | undefined): string | undefined {
  if (change === undefined || !Number.isFinite(change)) return undefined;
  if (Math.abs(change) < 0.05) return t("recap.time.same");
  return t(change > 0 ? "recap.time.more" : "recap.time.less", { pct: recapPercent(Math.abs(change)) });
}

/** 0.23 → "23 %" (German) / "23%"; unlike the analytics format not capped at 100. */
export function recapPercent(ratio: number): string {
  const value = new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(Math.round(ratio * 100));
  return appLanguage() === "en" ? `${value}%` : `${value} %`;
}

export function recapPersona(facts: RecapFacts): string {
  return t(`recap.persona.${facts.daypart ?? "anytime"}` as MessageKey);
}

export function recapTaste(facts: RecapFacts): string {
  return t(`recap.taste.${facts.taste}` as MessageKey);
}

export function recapPeakHour(facts: RecapFacts): string | undefined {
  return facts.peakHour === undefined ? undefined : t("recap.rhythm.peak", { hour: formatHour(facts.peakHour) });
}

export function recapCount(value: number): string {
  return formatCount(value);
}
