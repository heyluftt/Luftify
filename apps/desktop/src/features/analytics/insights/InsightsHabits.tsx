import { CalendarCheck, CircleCheck, Flame, Repeat2, SkipForward, TimerReset, type LucideIcon } from "lucide-react";
import { longestStreak } from "../../recap/recapPlan";
import { t } from "../../../i18n";
import { formatCount, formatListeningTime, formatPercentage } from "../analyticsFormatting";
import type { ListeningOverview } from "../analyticsTypes";

interface Habit {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  /** 0–1: drawn as a ring; numbers without a natural whole have none. */
  ratio?: number;
}

/**
 * How you listen, with explicit bases: plays only count titles heard long
 * enough; early skips are measured against every started title, so
 * "skipped" never exceeds "plays".
 */
export function InsightsHabits({ overview }: { overview: ListeningOverview }) {
  const { behavior } = overview;
  const started = Math.max(overview.sessionCount, behavior.skipCount, 1);
  const days = Math.max(1, Math.ceil((overview.toUnixMs - Math.max(overview.fromUnixMs, overview.dailyActivity[0]?.dayStartMs ?? overview.toUnixMs)) / 86_400_000));
  const habits: Habit[] = [
    {
      icon: CircleCheck,
      label: t("analytics.completed"),
      value: formatPercentage(behavior.completionRate),
      detail: t("analytics.completedHint", { n: formatCount(overview.completedPlayCount), total: formatCount(overview.qualifiedPlayCount) }),
      ratio: behavior.completionRate,
    },
    {
      icon: SkipForward,
      label: t("analytics.skippedEarly"),
      value: formatPercentage(behavior.skipCount / started),
      detail: t("analytics.skippedHint", { n: formatCount(behavior.skipCount), total: formatCount(started) }),
      ratio: behavior.skipCount / started,
    },
    {
      icon: CalendarCheck,
      label: t("analytics.activeDays"),
      value: formatCount(behavior.activeDayCount),
      detail: t("analytics.activeDaysHint", { total: formatCount(Math.max(days, behavior.activeDayCount)) }),
      ratio: behavior.activeDayCount / Math.max(days, behavior.activeDayCount),
    },
    { icon: TimerReset, label: t("analytics.averagePlay"), value: formatListeningTime(behavior.averagePlayMs ?? behavior.averageSessionMs), detail: t("analytics.averagePlayHint") },
    { icon: Flame, label: t("analytics.streak"), value: t("analytics.streakValue", { n: formatCount(longestStreak(overview.dailyActivity.filter((day) => day.listeningMs > 0))) }), detail: t("analytics.streakHint") },
    { icon: Repeat2, label: t("analytics.repeats"), value: formatCount(behavior.repeatCount), detail: t("analytics.repeatsHint") },
  ];
  return (
    <section className="insights-card insights-habits" aria-labelledby="insights-habits-title">
      <header className="insights-card-head"><h2 id="insights-habits-title">{t("analytics.habits")}</h2></header>
      <div className="insights-habit-grid">
        {habits.map((habit) => <div key={habit.label} className="insights-habit">
          {habit.ratio !== undefined
            ? <Ring ratio={habit.ratio} icon={habit.icon} />
            : <span className="insights-habit-icon" aria-hidden="true"><habit.icon size={18} /></span>}
          <span>
            <small>{habit.label}</small>
            <strong>{habit.value}</strong>
            <em>{habit.detail}</em>
          </span>
        </div>)}
      </div>
    </section>
  );
}

function Ring({ ratio, icon: Icon }: { ratio: number; icon: LucideIcon }) {
  const radius = 21;
  const length = 2 * Math.PI * radius;
  const filled = Math.min(1, Math.max(0, ratio)) * length;
  return <span className="insights-ring" aria-hidden="true">
    <svg className="insights-ring-gauge" viewBox="0 0 52 52">
      <circle className="insights-ring-track" cx="26" cy="26" r={radius} />
      <circle className="insights-ring-fill" cx="26" cy="26" r={radius} strokeDasharray={`${filled} ${length}`} />
    </svg>
    <Icon size={16} />
  </span>;
}
