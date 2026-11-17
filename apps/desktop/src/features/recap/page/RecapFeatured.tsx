import { CalendarRange, Play, Sparkles } from "lucide-react";
import { t } from "../../../i18n";
import { formatListeningTime } from "../../analytics/analyticsFormatting";
import { RecapCoverStack } from "../RecapCovers";
import { recapCount } from "../recapFormat";
import { recapKindIcon } from "../recapKindIcon";
import type { RecapPeriod, RecapPreview } from "../recapTypes";
import { useCoverPalette } from "./useCoverPalette";

/**
 * The look back to watch next, big and in the colours of its most played
 * cover. Further new ones wait underneath as small chips.
 */
export function RecapFeatured({ period, preview, isNew, others, onOpen }: {
  period: RecapPeriod;
  preview: RecapPreview | undefined;
  isNew: boolean;
  /** Other new recaps, newest first. */
  others: RecapPeriod[];
  onOpen: (period: RecapPeriod) => void;
}) {
  const covers = preview?.coverUris ?? [];
  const { coverData, style } = useCoverPalette(covers[0]);
  const Icon = recapKindIcon(period);
  const stats = [
    { label: t("recap.page.stat.time"), value: formatListeningTime(period.listeningMs) },
    { label: t("recap.page.stat.plays"), value: recapCount(period.playCount) },
    ...(preview?.topArtistName ? [{ label: t("recap.page.stat.artist"), value: preview.topArtistName }] : []),
    ...(preview?.topTrackTitle ? [{ label: t("recap.page.stat.track"), value: preview.topTrackTitle }] : []),
  ];

  return (
    <section className="recap-featured" style={style} data-kind={period.kind} aria-labelledby="recap-featured-title">
      <div className="recap-featured-backdrop" aria-hidden="true">{coverData && <img src={coverData} alt="" />}</div>
      <div className="recap-featured-copy">
        <span className="recap-featured-eyebrow">
          {isNew ? <Sparkles size={13} aria-hidden="true" /> : <Icon size={13} aria-hidden="true" />}
          {t(isNew ? "recap.page.featuredNew" : "recap.page.featuredLatest")}
          <span aria-hidden="true">·</span>{period.eyebrow}
        </span>
        <h2 id="recap-featured-title">{period.title}</h2>
        <p className="recap-featured-dates">
          <CalendarRange size={14} aria-hidden="true" />{period.dates}{period.provisional ? ` · ${t("recap.page.provisional")}` : ""}
        </p>
        <dl className="recap-featured-stats">
          {stats.map((stat) => <div key={stat.label}><dt>{stat.label}</dt><dd title={stat.value}>{stat.value}</dd></div>)}
        </dl>
        <div className="recap-featured-actions">
          <button type="button" className="recap-featured-watch" onClick={() => onOpen(period)}>
            <Play size={16} fill="currentColor" aria-hidden="true" />{t("recap.page.watch")}
          </button>
          {others.length > 0 && <div className="recap-featured-more">
            <small>{t("recap.page.alsoNew")}</small>
            {others.slice(0, 3).map((other) => <button key={other.id} type="button" onClick={() => onOpen(other)}>{other.title}</button>)}
          </div>}
        </div>
      </div>
      <button type="button" className="recap-featured-covers" onClick={() => onOpen(period)} tabIndex={-1} aria-hidden="true">
        <RecapCoverStack covers={covers} title={period.title} />
      </button>
    </section>
  );
}
