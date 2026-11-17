import { t, type MessageKey } from "../../../i18n";
import { formatCount, formatListeningTime } from "../analyticsFormatting";
import type { AnalyticsRangeKey, ListeningOverview } from "../analyticsTypes";
import { ActivityAreaChart } from "./ActivityAreaChart";
import { ChangeChip } from "./ChangeChip";
import { change } from "./insightsData";

const COMPARED: Record<AnalyticsRangeKey, MessageKey | undefined> = {
  today: "analytics.vs.today",
  sevenDays: "analytics.vs.sevenDays",
  thisMonth: "analytics.vs.thisMonth",
  ninetyDays: "analytics.vs.ninetyDays",
  thisYear: "analytics.vs.thisYear",
  all: undefined,
};

/**
 * The range at a glance: listening time as the one big number, its change
 * against the period before, three counts beside it and the course of the
 * range as a line.
 */
export function InsightsOverview({ overview, previous, rangeKey }: {
  overview: ListeningOverview;
  previous: ListeningOverview | undefined;
  rangeKey: AnalyticsRangeKey;
}) {
  const compared = COMPARED[rangeKey];
  const versus = compared ? t(compared) : "";
  const days = overview.behavior.activeDayCount;
  const counts = [
    { label: t("analytics.plays"), value: overview.qualifiedPlayCount, before: previous?.qualifiedPlayCount },
    { label: t("analytics.songs"), value: overview.uniqueTrackCount, before: previous?.uniqueTrackCount },
    { label: t("analytics.artists"), value: overview.uniqueArtistCount, before: previous?.uniqueArtistCount },
  ];
  return (
    <section className="insights-overview" aria-labelledby="insights-overview-title">
      <div className="insights-overview-figures">
        <div className="insights-hero-figure">
          <h2 id="insights-overview-title">{t("analytics.listeningTime")}</h2>
          <strong>{formatListeningTime(overview.totalListeningMs)}</strong>
          <span className="insights-hero-meta">
            {compared && <ChangeChip value={change(overview.totalListeningMs, previous?.totalListeningMs)} label={versus} />}
            <span>{days === 1 ? t("analytics.day") : t("analytics.days", { n: formatCount(days) })}{compared && previous ? ` · ${versus}` : ""}</span>
          </span>
        </div>
        <dl className="insights-counts">
          {counts.map((count) => <div key={count.label}>
            <dt>{count.label}</dt>
            <dd>{formatCount(count.value)}{compared && <ChangeChip value={change(count.value, count.before)} label={versus} />}</dd>
          </div>)}
        </dl>
      </div>
      <ActivityAreaChart overview={overview} rangeKey={rangeKey} />
    </section>
  );
}
