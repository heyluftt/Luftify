import { appLanguage, t } from "../../i18n";
import type { DailyListeningActivity } from "../analytics/analyticsTypes";
import type { RecapKind, RecapPeriod } from "./recapTypes";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Weeks shown in the archive; months, seasons and years stay. */
const WEEKS_KEPT = 12;
const DAY_MILESTONES = [100, 365, 730, 1095] as const;
const HOUR_MILESTONES = [100, 250, 500, 1000, 2500] as const;

/** Below these a recap would tell little: a few songs or two days are not a story. */
const THRESHOLDS: Record<RecapKind, { ms: number; plays: number; days: number }> = {
  week: { ms: 30 * 60_000, plays: 10, days: 3 },
  month: { ms: 2 * HOUR_MS, plays: 30, days: 5 },
  season: { ms: 5 * HOUR_MS, plays: 50, days: 14 },
  year: { ms: 5 * HOUR_MS, plays: 50, days: 14 },
  milestone: { ms: 0, plays: 0, days: 0 },
};

/** How long a finished recap counts as new. */
const FRESH_MS: Record<RecapKind, number> = {
  week: 7 * DAY_MS,
  month: 14 * DAY_MS,
  season: 21 * DAY_MS,
  year: 31 * DAY_MS,
  milestone: 14 * DAY_MS,
};

type Season = "spring" | "summer" | "autumn" | "winter";
const SEASON_START_MONTH: Record<Season, number> = { spring: 2, summer: 5, autumn: 8, winter: 11 };

function locale() {
  return appLanguage() === "en" ? "en-US" : "de-DE";
}

function format(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale(), options).format(date);
}

function dateRange(fromMs: number, toMs: number): string {
  const last = new Date(toMs - 1);
  const first = new Date(fromMs);
  const sameYear = first.getFullYear() === last.getFullYear();
  const start = format(first, sameYear
    ? { day: "numeric", month: "long" }
    : { day: "numeric", month: "long", year: "numeric" });
  return `${start} – ${format(last, { day: "numeric", month: "long", year: "numeric" })}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function mondayOf(date: Date): Date {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - offset);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function isoDay(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface Totals { listeningMs: number; playCount: number; activeDays: number }

function totals(days: DailyListeningActivity[], fromMs: number, toMs: number): Totals {
  let listeningMs = 0;
  let playCount = 0;
  let activeDays = 0;
  for (const day of days) {
    // By the middle of the day: a day stored under the other daylight-saving
    // offset starts an hour off and would slip into the neighbouring period.
    const noon = day.dayStartMs + DAY_MS / 2;
    if (noon >= fromMs && noon < toMs) {
      listeningMs += day.listeningMs;
      playCount += day.playCount;
      activeDays += 1;
    }
  }
  return { listeningMs, playCount, activeDays };
}

/**
 * Every recap worth offering, newest first. `days` are local calendar days
 * with listening (from the database); periods follow the local calendar,
 * so daylight saving time shifts nothing.
 */
export function buildRecapCatalog(days: DailyListeningActivity[], now = new Date()): RecapPeriod[] {
  const listened = days.filter((day) => day.listeningMs > 0).sort((a, b) => a.dayStartMs - b.dayStartMs);
  const first = listened[0];
  if (!first) return [];
  const nowMs = now.getTime();
  const history = new Date(first.dayStartMs);
  const periods: RecapPeriod[] = [];

  const add = (
    kind: RecapKind,
    id: string,
    from: Date,
    to: Date,
    title: string,
    options: { previousFrom?: Date; provisional?: boolean; eyebrow?: string } = {},
  ) => {
    const sum = totals(listened, from.getTime(), to.getTime());
    const threshold = THRESHOLDS[kind];
    if (sum.listeningMs < threshold.ms || sum.playCount < threshold.plays || sum.activeDays < threshold.days) return;
    periods.push({
      id,
      kind,
      fromMs: from.getTime(),
      toMs: to.getTime(),
      ...(options.previousFrom ? { previousFromMs: options.previousFrom.getTime() } : {}),
      title,
      eyebrow: options.eyebrow ?? t(`recap.kind.${kind}`),
      dates: dateRange(from.getTime(), to.getTime()),
      listeningMs: sum.listeningMs,
      playCount: sum.playCount,
      fresh: nowMs - to.getTime() < FRESH_MS[kind],
      ...(options.provisional ? { provisional: true } : {}),
    });
  };

  // Finished weeks, Monday to Monday.
  const thisWeek = mondayOf(now);
  const weeks: Date[] = [];
  for (let week = mondayOf(history); week < thisWeek; week = new Date(week.getFullYear(), week.getMonth(), week.getDate() + 7)) {
    weeks.push(week);
  }
  for (const week of weeks.slice(-WEEKS_KEPT)) {
    const end = new Date(week.getFullYear(), week.getMonth(), week.getDate() + 7);
    const previous = new Date(week.getFullYear(), week.getMonth(), week.getDate() - 7);
    add("week", `week:${isoDay(week)}`, week, end,
      t("recap.title.week", { date: format(week, { day: "numeric", month: "long" }) }),
      { previousFrom: previous });
  }

  // Finished months.
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let month = new Date(history.getFullYear(), history.getMonth(), 1); month < thisMonth; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const previous = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    add("month", `month:${month.getFullYear()}-${pad(month.getMonth() + 1)}`, month, end,
      format(month, { month: "long", year: "numeric" }), { previousFrom: previous });
  }

  // Finished seasons (meteorological: spring from March …).
  for (let year = history.getFullYear() - 1; year <= now.getFullYear(); year += 1) {
    for (const season of Object.keys(SEASON_START_MONTH) as Season[]) {
      const start = new Date(year, SEASON_START_MONTH[season], 1);
      const end = new Date(year, SEASON_START_MONTH[season] + 3, 1);
      if (end > now || end.getTime() <= first.dayStartMs) continue;
      const label = season === "winter" ? `${year}/${String(year + 1).slice(-2)}` : String(year);
      add("season", `season:${year}-${season}`, start, end,
        t(`recap.season.${season}`, { year: label }), { previousFrom: new Date(year, SEASON_START_MONTH[season] - 3, 1) });
    }
  }

  // Finished years, and in December the year so far.
  for (let year = history.getFullYear(); year < now.getFullYear(); year += 1) {
    add("year", `year:${year}`, new Date(year, 0, 1), new Date(year + 1, 0, 1),
      t("recap.title.year", { year }), { previousFrom: new Date(year - 1, 0, 1) });
  }
  if (now.getMonth() === 11) {
    const year = now.getFullYear();
    add("year", `year:${year}-so-far`, new Date(year, 0, 1), startOfDay(now),
      t("recap.title.year", { year }), { previousFrom: new Date(year - 1, 0, 1), provisional: true });
  }

  // Milestones: all listening from the first day until the moment.
  for (const count of DAY_MILESTONES) {
    const reached = new Date(history.getFullYear(), history.getMonth(), history.getDate() + count);
    if (reached > now) break;
    add("milestone", `milestone:days-${count}`, history, reached,
      count === 365 ? t("recap.milestone.year") : count % 365 === 0
        ? t("recap.milestone.years", { n: count / 365 })
        : t("recap.milestone.days", { n: count }));
  }
  let cumulative = 0;
  let nextHour = 0;
  for (const day of listened) {
    cumulative += day.listeningMs;
    while (nextHour < HOUR_MILESTONES.length && cumulative >= HOUR_MILESTONES[nextHour]! * HOUR_MS) {
      const end = new Date(day.dayStartMs + DAY_MS);
      if (end <= now) {
        add("milestone", `milestone:hours-${HOUR_MILESTONES[nextHour]}`, history, end,
          t("recap.milestone.hours", { n: HOUR_MILESTONES[nextHour]! }));
      }
      nextHour += 1;
    }
  }

  return periods.sort((left, right) => right.toMs - left.toMs || kindOrder(left.kind) - kindOrder(right.kind));
}

/** On the same end date the bigger look back leads. */
function kindOrder(kind: RecapKind): number {
  return ["milestone", "year", "season", "month", "week"].indexOf(kind);
}
