import { appLanguage, t, type MessageKey } from "../../../i18n";
import { formatHour, formatListeningTime } from "../analyticsFormatting";
import type { ListeningOverview } from "../analyticsTypes";
import { peakDaypart } from "../peakDaypart";
import { hourTotals, indexOfMax, weekdayTotals } from "./insightsData";

const SIZE = 220;
const CENTER = SIZE / 2;
const INNER = 46;
const REACH = 52;

/** When the music plays: a 24-hour dial and the seven weekdays. */
export function InsightsRhythm({ overview }: { overview: ListeningOverview }) {
  return (
    <section className="insights-rhythm" aria-label={t("analytics.rhythmAria")}>
      <HourDial overview={overview} />
      <Weekdays overview={overview} />
    </section>
  );
}

function HourDial({ overview }: { overview: ListeningOverview }) {
  const hours = hourTotals(overview);
  const max = Math.max(...hours);
  const peak = peakDaypart(overview.hourlyActivity ?? []);
  const busiest = indexOfMax(hours);
  return (
    <article className="insights-card insights-dial-card">
      <header className="insights-card-head"><h2>{t("analytics.byHour")}</h2></header>
      {max <= 0 ? <p className="insights-chart-empty">{t("analytics.activityEmpty")}</p> : <div className="insights-dial">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={t("analytics.activityChartHourly")}>
          <circle className="insights-dial-ring" cx={CENTER} cy={CENTER} r={INNER - 6} />
          {hours.map((value, hour) => {
            const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
            const length = value > 0 ? Math.max(4, (value / max) * REACH) : 0;
            const from = INNER;
            const to = INNER + length;
            return <g key={hour}>
              <line className="insights-dial-track" x1={CENTER + Math.cos(angle) * from} y1={CENTER + Math.sin(angle) * from}
                x2={CENTER + Math.cos(angle) * (INNER + REACH)} y2={CENTER + Math.sin(angle) * (INNER + REACH)} />
              {length > 0 && <line className="insights-dial-bar" data-peak={hour === busiest || undefined}
                x1={CENTER + Math.cos(angle) * from} y1={CENTER + Math.sin(angle) * from}
                x2={CENTER + Math.cos(angle) * to} y2={CENTER + Math.sin(angle) * to}>
                <title>{`${formatHour(hour)}: ${formatListeningTime(value)}`}</title>
              </line>}
            </g>;
          })}
          {[0, 6, 12, 18].map((hour) => {
            const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
            const radius = INNER - 16;
            return <text key={hour} className="insights-dial-label" x={CENTER + Math.cos(angle) * radius} y={CENTER + Math.sin(angle) * radius}>{hour}</text>;
          })}
        </svg>
        {peak && <p className="insights-dial-copy">
          <strong>{t(`analytics.daypart.${peak.daypart}` as MessageKey)}</strong>
          <small>{t("analytics.peakHour", { hour: formatHour(peak.hour) })}</small>
        </p>}
      </div>}
    </article>
  );
}

function Weekdays({ overview }: { overview: ListeningOverview }) {
  const totals = weekdayTotals(overview.dailyActivity);
  const max = Math.max(...totals);
  const best = indexOfMax(totals);
  // Monday 2024-01-01 onwards gives the weekday names in the app's language.
  const name = (index: number, style: "short" | "long") => new Intl.DateTimeFormat(appLanguage(), { weekday: style }).format(new Date(2024, 0, 1 + index));
  return (
    <article className="insights-card insights-week-card">
      <header className="insights-card-head">
        <h2>{t("analytics.byWeekday")}</h2>
        {max > 0 && <span className="insights-card-note">{t("analytics.bestWeekday", { day: name(best, "long") })}</span>}
      </header>
      {max <= 0 ? <p className="insights-chart-empty">{t("analytics.activityEmpty")}</p> : <div className="insights-weekdays" role="img" aria-label={t("analytics.byWeekday")}>
        {totals.map((value, index) => <div key={index} className="insights-weekday" data-best={index === best || undefined}
          title={`${name(index, "long")}: ${formatListeningTime(value)}`}>
          <span className="insights-weekday-value">{index === best ? formatListeningTime(value) : ""}</span>
          <span className="insights-weekday-track"><i style={{ height: `${value > 0 ? Math.max(4, (value / max) * 100) : 0}%` }} /></span>
          <small>{name(index, "short").replace(".", "")}</small>
        </div>)}
      </div>}
    </article>
  );
}
