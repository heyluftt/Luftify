import { useMemo } from "react";
import { t } from "../../../i18n";
import type { DailyListeningActivity } from "../../analytics/analyticsTypes";
import type { RecapPeriod, RecapPreview } from "../recapTypes";
import { yearStats, type RecapYear } from "./recapArchive";
import { RecapMomentTile, RecapMonthTile } from "./RecapTiles";
import { RecapWeeks } from "./RecapWeeks";
import { RecapYearCalendar } from "./RecapYearCalendar";

/** Everything of one year: the calendar, its highlights, twelve months and the weeks. */
export function RecapYearSection({ year, days, previews, isNew, onOpen, now = new Date() }: {
  year: RecapYear;
  days: DailyListeningActivity[];
  previews: Map<string, RecapPreview>;
  isNew: (period: RecapPeriod) => boolean;
  onOpen: (period: RecapPeriod) => void;
  now?: Date;
}) {
  const current = year.year === now.getFullYear();
  const stats = useMemo(() => yearStats(days, year.year), [days, year.year]);
  const history = useMemo(() => {
    const first = days.filter((day) => day.listeningMs > 0).reduce((min, day) => Math.min(min, day.dayStartMs), Infinity);
    return Number.isFinite(first) ? new Date(first) : new Date();
  }, [days]);
  const highlights = [...(year.yearRecap ? [year.yearRecap] : []), ...year.seasons, ...year.milestones];

  const monthState = (month: number): "recap" | "running" | "quiet" | "future" => {
    if (year.months[month]) return "recap";
    const start = new Date(year.year, month, 1);
    if (start > now) return "future";
    if (current && month === now.getMonth()) return "running";
    // Months before the first day with Luftify stay blank.
    return new Date(year.year, month + 1, 1) <= history ? "future" : "quiet";
  };

  return (
    <div className="recap-year">
      <RecapYearCalendar year={year.year} days={days} weeks={year.weeks} current={current} onOpen={onOpen} />
      {highlights.length > 0 && (
        <section className="recap-highlights" aria-labelledby={`recap-highlights-${year.year}`}>
          <div className="recap-section-head"><h3 id={`recap-highlights-${year.year}`}>{t("recap.page.highlights")}</h3></div>
          <div className="recap-highlight-grid">
            {highlights.map((period) => <RecapMomentTile key={period.id} period={period} preview={previews.get(period.id)} isNew={isNew(period)} onOpen={onOpen} />)}
          </div>
        </section>
      )}
      <section className="recap-months" aria-labelledby={`recap-months-${year.year}`}>
        <div className="recap-section-head"><h3 id={`recap-months-${year.year}`}>{t("recap.page.months")}</h3></div>
        <div className="recap-month-grid">
          {year.months.map((period, month) => {
            const state = monthState(month);
            return <RecapMonthTile key={month} month={month} period={period} preview={period ? previews.get(period.id) : undefined}
              isNew={Boolean(period && isNew(period))} state={state} soFarMs={stats.monthMs[month] ?? 0} onOpen={onOpen} />;
          })}
        </div>
      </section>
      <RecapWeeks weeks={year.weeks} previews={previews} isNew={isNew} onOpen={onOpen} />
    </div>
  );
}
