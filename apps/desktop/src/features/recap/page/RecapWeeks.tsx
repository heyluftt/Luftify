import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { appLanguage, t } from "../../../i18n";
import { RecapCoverRow } from "../RecapCovers";
import type { RecapPeriod, RecapPreview } from "../recapTypes";
import { NewBadge } from "./RecapTiles";
import { shortTime } from "./recapPageFormat";

const COLLAPSED = 4;
const TREND = new Intl.NumberFormat(appLanguage(), { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 0 });

/**
 * The weeks of the year, newest first, each with its share of the busiest
 * week as a bar and its change against the week before.
 */
export function RecapWeeks({ weeks, previews, isNew, onOpen }: {
  weeks: RecapPeriod[];
  previews: Map<string, RecapPreview>;
  isNew: (period: RecapPeriod) => boolean;
  onOpen: (period: RecapPeriod) => void;
}) {
  const [all, setAll] = useState(false);
  if (!weeks.length) return null;
  const max = Math.max(...weeks.map((week) => week.listeningMs));
  const shown = all ? weeks : weeks.slice(0, COLLAPSED);
  return (
    <section className="recap-weeks" aria-labelledby="recap-weeks-title">
      <div className="recap-section-head"><h3 id="recap-weeks-title">{t("recap.page.group.weeks")}</h3></div>
      <ol>
        {shown.map((week, index) => {
          const before = weeks[weeks.indexOf(week) + 1];
          const change = before && before.listeningMs > 0 ? week.listeningMs / before.listeningMs - 1 : undefined;
          const preview = previews.get(week.id);
          return <li key={week.id} style={{ "--i": index } as CSSProperties}>
            <button type="button" className="recap-week" onClick={() => onOpen(week)}>
              <RecapCoverRow covers={preview?.coverUris ?? []} title={week.title} />
              <span className="recap-week-copy">
                <strong>{week.title}{isNew(week) && <NewBadge />}</strong>
                <small>{preview?.topArtistName ? t("recap.page.mostly", { name: preview.topArtistName }) : week.dates}</small>
              </span>
              <span className="recap-week-meter" aria-hidden="true"><i style={{ width: `${Math.max(4, (week.listeningMs / max) * 100)}%` }} /></span>
              <span className="recap-week-time">
                {shortTime(week.listeningMs)}
                {change !== undefined && Math.abs(change) >= 0.01 && <small data-trend={change > 0 ? "up" : "down"} title={t("recap.page.vsLastWeek")}>{TREND.format(change)}</small>}
              </span>
              <ChevronRight className="recap-week-chevron" size={17} aria-hidden="true" />
            </button>
          </li>;
        })}
      </ol>
      {weeks.length > COLLAPSED && (
        <button type="button" className="recap-more" aria-expanded={all} onClick={() => setAll((value) => !value)}>
          {t(all ? "recap.page.lessWeeks" : "recap.page.moreWeeks")}<ChevronDown size={15} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
