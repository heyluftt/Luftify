import { useId, useMemo, useState } from "react";
import { t } from "../../../i18n";
import {
  activityGranularity,
  calendarBuckets,
  countRangeDays,
  hourlyBuckets,
  type ActivityBucket,
} from "../activityBuckets";
import { formatActivityLabel, formatListeningTime } from "../analyticsFormatting";
import type { AnalyticsRangeKey, ListeningOverview } from "../analyticsTypes";

const WIDTH = 1000;
const HEIGHT = 220;
const TOP = 12;

/**
 * Listening across the range as one line with a light wash below: hours for
 * today, days up to three months, then weeks and months. Pointing at the
 * chart shows the bucket's time.
 */
export function ActivityAreaChart({ overview, rangeKey }: { overview: ListeningOverview; rangeKey: AnalyticsRangeKey }) {
  const gradient = useId();
  const [hovered, setHovered] = useState<number>();
  const offset = -new Date(overview.toUnixMs).getTimezoneOffset();
  const granularity = activityGranularity(rangeKey, countRangeDays(overview.fromUnixMs, overview.toUnixMs, overview.dailyActivity));
  const buckets = useMemo<ActivityBucket[]>(() => granularity === "hour"
    // Today ends at the current hour; later ones have not happened yet.
    ? hourlyBuckets(overview.hourlyActivity ?? []).slice(0, new Date(overview.toUnixMs).getHours() + 1)
    : calendarBuckets(overview.dailyActivity, overview.fromUnixMs, overview.toUnixMs, offset, granularity),
  [granularity, offset, overview]);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.listeningMs));
  if (!buckets.some((bucket) => bucket.listeningMs > 0)) return <p className="insights-chart-empty">{t("analytics.activityEmpty")}</p>;

  const label = (bucket: ActivityBucket) => formatActivityLabel(bucket.start, granularity, offset);
  const x = (index: number) => buckets.length === 1 ? WIDTH / 2 : (index / (buckets.length - 1)) * WIDTH;
  const y = (value: number) => HEIGHT - (value / max) * (HEIGHT - TOP);
  const points = buckets.map((bucket, index) => `${x(index).toFixed(1)},${y(bucket.listeningMs).toFixed(1)}`);
  const line = `M${points.join(" L")}`;
  const area = `${line} L${x(buckets.length - 1)},${HEIGHT} L${x(0)},${HEIGHT} Z`;
  const focus = hovered;
  const focusBucket = focus === undefined ? undefined : buckets[focus];
  const share = (index: number) => (buckets.length === 1 ? 50 : (index / (buckets.length - 1)) * 100);
  const middle = Math.floor((buckets.length - 1) / 2);

  return (
    <figure className="insights-area" aria-label={t(granularity === "hour" ? "analytics.activityChartHourly" : granularity === "week"
      ? "analytics.activityChartWeekly" : granularity === "month" ? "analytics.activityChartMonthly" : "analytics.activityChart")}>
      <div className="insights-area-plot" onPointerLeave={() => setHovered(undefined)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity=".28" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="insights-area-grid" x1="0" x2={WIDTH} y1={y(max / 2)} y2={y(max / 2)} vectorEffect="non-scaling-stroke" />
          <line className="insights-area-base" x1="0" x2={WIDTH} y1={HEIGHT - .5} y2={HEIGHT - .5} vectorEffect="non-scaling-stroke" />
          <path d={area} fill={`url(#${gradient})`} />
          <path className="insights-area-line" d={line} vectorEffect="non-scaling-stroke" />
          {focus !== undefined && <line className="insights-area-cursor" x1={x(focus)} x2={x(focus)} y1={TOP} y2={HEIGHT} vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* Only while pointing; the dot as HTML, so it stays round in the stretched plot. */}
        {focus !== undefined && focusBucket && <>
          <i className="insights-area-dot" style={{ left: `${share(focus)}%`, top: `calc(var(--plot-top) + (100% - var(--plot-top)) * ${(y(focusBucket.listeningMs) / HEIGHT).toFixed(4)})` }} aria-hidden="true" />
          <span className="insights-area-tip" style={{ left: `${Math.min(88, Math.max(12, share(focus)))}%` }} role="status">
            <small>{label(focusBucket)}</small>
            <strong>{formatListeningTime(focusBucket.listeningMs)}</strong>
          </span>
        </>}
        <div className="insights-area-hits" style={{ gridTemplateColumns: `repeat(${buckets.length}, 1fr)` }}>
          {buckets.map((bucket, index) => <span key={bucket.key} onPointerEnter={() => setHovered(index)}
            title={`${label(bucket)}: ${formatListeningTime(bucket.listeningMs)}`} />)}
        </div>
      </div>
      <figcaption className="insights-area-axis" aria-hidden="true">
        <span>{label(buckets[0]!)}</span>
        {buckets.length > 4 && <span>{label(buckets[middle]!)}</span>}
        <span>{label(buckets.at(-1)!)}</span>
      </figcaption>
    </figure>
  );
}
