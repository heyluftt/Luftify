import type { CSSProperties } from "react";
import { appLanguage } from "../../i18n";
import { formatListeningTime } from "../analytics/analyticsFormatting";
import type { DailyListeningActivity } from "../analytics/analyticsTypes";

// One bar per day, scaled to the busiest day. Details stay in the tooltip.
export function HomeWeekPulse({ days }: { days: DailyListeningActivity[] }) {
  if (days.length < 2) return null;
  const peak = Math.max(...days.map((day) => day.listeningMs), 1);
  const weekday = new Intl.DateTimeFormat(appLanguage() === "en" ? "en-US" : "de-DE", { weekday: "short" });
  return (
    <div className="home-week-pulse" aria-hidden="true">
      {days.map((day, index) => (
        <span
          key={day.dayStartMs}
          className={day.listeningMs > 0 ? undefined : "is-empty"}
          title={`${weekday.format(new Date(day.dayStartMs))} · ${formatListeningTime(day.listeningMs)}`}
          style={{ "--h": Math.max(0.08, day.listeningMs / peak), "--i": index } as CSSProperties}
        />
      ))}
    </div>
  );
}
