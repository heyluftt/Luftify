import { Gift, RefreshCw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { t } from "../i18n";
import { AnalyticsDisabledState } from "../features/analytics/AnalyticsStates";
import { recapYears } from "../features/recap/page/recapArchive";
import { RecapFeatured } from "../features/recap/page/RecapFeatured";
import { shortTime } from "../features/recap/page/recapPageFormat";
import { RecapYearSection } from "../features/recap/page/RecapYearSection";
import { useRecapStore } from "../features/recap/recapStore";
import type { RecapPeriod } from "../features/recap/recapTypes";
import { useRecapCatalog, useRecapPreviews } from "../features/recap/useRecaps";
import "../styles/pages/recaps.css";

/**
 * Every look back in one place: the one to watch next up front, then the
 * archive by year — a listening calendar, the highlights, twelve months and
 * the weeks.
 */
export function RecapsPage() {
  const { periods, seen, query, days, enabled } = useRecapCatalog();
  const previews = useRecapPreviews(periods);
  const open = useRecapStore((store) => store.open);
  const isNew = (period: RecapPeriod) => period.fresh && !seen.has(period.id);
  const years = useMemo(() => recapYears(periods, days ?? []), [periods, days]);
  const fresh = periods.filter(isNew);
  const featured = fresh[0] ?? periods[0];
  const [chosen, setChosen] = useState<number | null>(null);
  const year = years.find((entry) => entry.year === chosen) ?? years[0];

  let content: ReactNode;
  if (!enabled) {
    content = <AnalyticsDisabledState />;
  } else if (query.isError) {
    content = (
      <div className="recaps-state">
        <Gift aria-hidden="true" />
        <h2>{t("recap.page.unavailable")}</h2>
        <button type="button" className="secondary-button" onClick={() => void query.refetch()}>
          <RefreshCw size={15} aria-hidden="true" />{t("miniplayer.retry")}
        </button>
      </div>
    );
  } else if (!query.isSuccess) {
    content = <div className="recaps-loading" aria-label={t("recap.story.loading")}><span /><span /><span /><span /></div>;
  } else if (!featured || !year) {
    content = (
      <div className="recaps-state">
        <Gift aria-hidden="true" />
        <h2>{t("recap.page.emptyTitle")}</h2>
        <p>{t("recap.page.emptyBody")}</p>
      </div>
    );
  } else {
    content = (
      <div className="recaps-content">
        <RecapFeatured period={featured} preview={previews.get(featured.id)} isNew={isNew(featured)}
          others={fresh.filter((period) => period !== featured)} onOpen={open} />
        <section className="recaps-archive" aria-labelledby="recaps-archive-title">
          <div className="recaps-archive-head">
            <h2 id="recaps-archive-title">{t("recap.page.archive")}</h2>
            {years.length > 1 && (
              <div className="recaps-years" role="tablist" aria-label={t("recap.page.archive")}>
                {years.map((entry) => {
                  const total = (days ?? []).reduce((sum, day) => new Date(day.dayStartMs + 43_200_000).getFullYear() === entry.year ? sum + day.listeningMs : sum, 0);
                  return <button key={entry.year} type="button" role="tab" aria-selected={entry === year} onClick={() => setChosen(entry.year)}>
                    {entry.year}{total > 0 && <small>{shortTime(total)}</small>}
                  </button>;
                })}
              </div>
            )}
          </div>
          <RecapYearSection key={year.year} year={year} days={days ?? []} previews={previews} isNew={isNew} onOpen={open} />
        </section>
      </div>
    );
  }

  return (
    <div className="page recaps-page">
      <header className="page-heading recaps-heading">
        <h1>{t("nav.recaps")}</h1>
        <p>{t("recap.page.subtitle")}</p>
      </header>
      {content}
    </div>
  );
}
