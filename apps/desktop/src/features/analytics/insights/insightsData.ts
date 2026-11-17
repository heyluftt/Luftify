import type { DailyListeningActivity, ListeningOverview } from "../analyticsTypes";

/** Change against the period before (-1 … ∞); nothing without a period before. */
export function change(current: number, previous: number | undefined | null): number | undefined {
  if (previous == null || previous <= 0) return undefined;
  return current / previous - 1;
}

/** Listening per weekday, Monday first, over the days of the range. */
export function weekdayTotals(days: DailyListeningActivity[]): number[] {
  const totals = Array.from({ length: 7 }, () => 0);
  for (const day of days) {
    // Noon: a daylight-saving day starts an hour off but stays on its weekday.
    const weekday = (new Date(day.dayStartMs + 43_200_000).getDay() + 6) % 7;
    totals[weekday]! += day.listeningMs;
  }
  return totals;
}

/** Listening per hour of the day, 0–23. */
export function hourTotals(overview: ListeningOverview): number[] {
  const totals = Array.from({ length: 24 }, () => 0);
  for (const entry of overview.hourlyActivity ?? []) {
    if (entry.hour >= 0 && entry.hour < 24) totals[entry.hour]! += entry.listeningMs;
  }
  return totals;
}

export function indexOfMax(values: number[]): number {
  return values.reduce((best, value, index) => (value > values[best]! ? index : best), 0);
}
