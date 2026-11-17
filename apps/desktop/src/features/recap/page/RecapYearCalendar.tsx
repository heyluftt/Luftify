import { CalendarDays, Clock3, Flame, Trophy } from "lucide-react";
import { useMemo } from "react";
import { t } from "../../../i18n";
import { formatListeningTime } from "../../analytics/analyticsFormatting";
import type { DailyListeningActivity } from "../../analytics/analyticsTypes";
import type { RecapPeriod } from "../recapTypes";
import { heatmapWeeks, weekOf, yearStats } from "./recapArchive";
import { dayLabel, monthName } from "./recapPageFormat";

/**
 * A year of listening on one screen: every day a square, coloured by how
 * much music it had, with the year's numbers beside it. A day with a week
 * recap opens it.
 */
export function RecapYearCalendar({ year, days, weeks, current, onOpen }: {
  year: number;
  days: DailyListeningActivity[];
  weeks: RecapPeriod[];
  /** The year still runs: "so far" instead of a finished total. */
  current: boolean;
  onOpen: (period: RecapPeriod) => void;
}) {
  const grid = useMemo(() => heatmapWeeks(days, year), [days, year]);
  const stats = useMemo(() => yearStats(days, year), [days, year]);
  const facts = [
    { icon: Clock3, label: t(current ? "recap.page.year.timeSoFar" : "recap.page.year.time"), value: formatListeningTime(stats.listeningMs) },
    { icon: CalendarDays, label: t("recap.page.year.days"), value: t("recap.page.year.daysValue", { n: stats.activeDays }) },
    { icon: Flame, label: t("recap.page.year.streak"), value: t("recap.page.year.daysValue", { n: stats.longestStreak }) },
    ...(stats.busiestDay ? [{
      icon: Trophy,
      label: t("recap.page.year.busiest"),
      value: `${dayLabel(new Date(stats.busiestDay.dayStartMs + 43_200_000))} · ${formatListeningTime(stats.busiestDay.listeningMs)}`,
    }] : []),
  ];

  return (
    <section className="recap-year-calendar" aria-labelledby={`recap-calendar-${year}`}>
      <div className="recap-section-head">
        <h3 id={`recap-calendar-${year}`}>{t("recap.page.calendar")}</h3>
        <span className="recap-heat-legend" aria-hidden="true">
          {t("recap.page.less")}{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}{t("recap.page.more")}
        </span>
      </div>
      <div className="recap-year-body">
        <div className="recap-heat-scroll">
          <div className="recap-heat" style={{ gridTemplateColumns: `repeat(${grid.length}, var(--heat-cell))` }}>
            {grid.map((week, column) => {
              const firstOfMonth = week.find((cell) => !cell.outside && cell.date.getDate() === 1);
              return firstOfMonth
                ? <span key={`m${column}`} className="recap-heat-month" style={{ gridColumn: column + 1 }}>{monthName(firstOfMonth.date.getMonth(), "short")}</span>
                : null;
            })}
            {grid.flatMap((week, column) => week.map((cell, row) => {
              const place = { gridColumn: column + 1, gridRow: row + 2 };
              if (cell.outside) return <span key={`${column}-${row}`} className="recap-heat-cell" data-outside style={place} />;
              const label = `${dayLabel(cell.date)} · ${cell.listeningMs ? formatListeningTime(cell.listeningMs) : t("recap.page.noMusic")}`;
              const week = cell.listeningMs ? weekOf(cell.date, weeks) : undefined;
              return week
                ? <button key={`${column}-${row}`} type="button" className="recap-heat-cell" data-level={cell.level} style={place}
                  title={`${label} · ${week.title}`} aria-label={`${label}, ${week.title}`} onClick={() => onOpen(week)} />
                : <span key={`${column}-${row}`} className="recap-heat-cell" data-level={cell.level} data-future={cell.future || undefined} style={place} title={cell.future ? undefined : label} />;
            }))}
          </div>
        </div>
        <dl className="recap-year-facts">
          {facts.map((fact) => <div key={fact.label}>
            <dt><fact.icon size={14} aria-hidden="true" />{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>)}
        </dl>
      </div>
    </section>
  );
}
