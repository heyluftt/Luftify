import type { CSSProperties } from "react";
import { appLanguage } from "../../i18n";
import { recapActivity, recapHours } from "./recapChartData";
import type { ListeningRecap, RecapPeriod } from "./recapTypes";
import "../../styles/pages/recap-charts.css";

type BarStyle = CSSProperties & Record<"--bar" | "--recap-delay", string>;

/** Bar height as a share of the busiest bar; a heard bucket never vanishes. */
function barHeight(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "0";
  return String(Math.max(0.06, value / max));
}

/**
 * The period as bars that grow in one after another. Purely visual: the
 * slide already says the numbers in words.
 */
export function RecapActivityChart({ recap, period, delayMs }: {
  recap: ListeningRecap;
  period: RecapPeriod;
  delayMs: number;
}) {
  const activity = recapActivity(recap.overview.dailyActivity, period, appLanguage());
  if (activity.peak < 0 || activity.bars.length < 2) return null;
  const max = activity.bars[activity.peak]!.value;
  const step = Math.min(70, 700 / activity.bars.length);
  return (
    <div className={`recap-chart recap-chart-${activity.unit}`} aria-hidden="true">
      <div className="recap-chart-bars">
        {activity.bars.map((bar, index) => (
          <span
            key={bar.startMs}
            className={index === activity.peak ? "is-peak" : undefined}
            style={{ "--bar": barHeight(bar.value, max), "--recap-delay": `${delayMs + index * step}ms` } as BarStyle}
          />
        ))}
      </div>
      <div className="recap-chart-axis">
        {activity.bars.map((bar) => <span key={bar.startMs}>{bar.label}</span>)}
      </div>
    </div>
  );
}

/** Listening over the 24 hours of a day, the favourite hour lit. */
export function RecapHourChart({ recap, peakHour, delayMs }: {
  recap: ListeningRecap;
  peakHour: number | undefined;
  delayMs: number;
}) {
  const hours = recapHours(recap.overview.hourlyActivity ?? []);
  const max = Math.max(...hours);
  if (max <= 0) return null;
  return (
    <div className="recap-chart recap-chart-hours" aria-hidden="true">
      <div className="recap-chart-bars">
        {hours.map((value, hour) => (
          <span
            key={hour}
            className={hour === peakHour ? "is-peak" : undefined}
            style={{ "--bar": barHeight(value, max), "--recap-delay": `${delayMs + hour * 28}ms` } as BarStyle}
          />
        ))}
      </div>
      <div className="recap-chart-axis">
        {hours.map((_, hour) => <span key={hour}>{hour % 6 === 0 ? hour : ""}</span>)}
      </div>
    </div>
  );
}
