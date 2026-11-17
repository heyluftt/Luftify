import type { CSSProperties } from "react";
import { AlbumArt } from "../../components/AlbumArt";
import { appLanguage, t } from "../../i18n";
import { joinCreatorNames } from "../analytics/analyticsFormatting";
import { recapActivity } from "./recapChartData";
import { recapAmount, recapCount, recapPersona } from "./recapFormat";
import type { RecapFacts } from "./recapPlan";
import type { ListeningRecap, RecapPeriod } from "./recapTypes";
import "../../styles/pages/recap-poster.css";

type SparkStyle = CSSProperties & Record<"--bar", string>;

/**
 * The shareable end card, laid out like the saved image (recapShareImage):
 * a 4:5 poster in the colours of the top cover. What you see is what you
 * share.
 */
export function RecapPoster({ recap, period, facts, coverData }: {
  recap: ListeningRecap;
  period: RecapPeriod;
  facts: RecapFacts;
  coverData: string | undefined;
}) {
  const amount = recapAmount(recap.overview.totalListeningMs);
  const top = recap.overview.topTracks[0];
  const activity = recapActivity(recap.overview.dailyActivity, period, appLanguage());
  const max = activity.peak >= 0 ? activity.bars[activity.peak]!.value : 0;

  return (
    // The frame is the size container, so every cqw in the poster (its
    // padding and radius included) refers to the poster's own width.
    <div className="recap-poster-frame">
      <article className="recap-poster">
        <span className="recap-poster-bg" aria-hidden="true">{coverData && <img src={coverData} alt="" />}</span>

        <header className="recap-poster-head">
          <span className="recap-poster-brand"><i aria-hidden="true" />{t("recap.brand")}</span>
          <h3>{period.title}</h3>
          <small>{period.dates}</small>
        </header>

        <div className="recap-poster-hero">
          {top && (
            <span className="recap-poster-cover">
              <AlbumArt title={top.track.title} image={top.track.coverUri} size="large" priority />
            </span>
          )}
          <div className="recap-poster-amount">
            <strong>{recapCount(amount.value)}</strong>
            <span>{amount.unit}</span>
            <dl>
              <div><dt>{t("recap.page.stat.plays")}</dt><dd>{recapCount(recap.overview.qualifiedPlayCount)}</dd></div>
              <div><dt>{t("recap.summary.activeDays")}</dt><dd>{facts.activeDays}/{facts.periodDays}</dd></div>
            </dl>
          </div>
        </div>

        <div className="recap-poster-lists">
          <section>
            <h4>{t("recap.summary.topSongs")}</h4>
            <ol>
              {recap.overview.topTracks.slice(0, 5).map((entry, index) => (
                <li key={entry.track.uri}>
                  <b>{index + 1}</b>
                  <AlbumArt title={entry.track.title} image={entry.track.coverUri} size="tiny" priority />
                  <span><strong>{entry.track.title}</strong><small>{joinCreatorNames(entry.track.creators)}</small></span>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h4>{t("recap.summary.topArtists")}</h4>
            <ol className="recap-poster-artists">
              {recap.overview.topArtists.slice(0, 5).map((entry, index) => (
                <li key={entry.creator.uri ?? entry.creator.name}>
                  <b>{index + 1}</b>
                  <strong>{entry.creator.name}</strong>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <footer className="recap-poster-foot">
          <span>
            <small>{t("recap.summary.type")}</small>
            <strong>{recapPersona(facts)}</strong>
          </span>
          {max > 0 && (
            <span className="recap-poster-spark" aria-hidden="true">
              {activity.bars.map((bar, index) => (
                <i
                  key={bar.startMs}
                  className={index === activity.peak ? "is-peak" : undefined}
                  style={{ "--bar": String(bar.value > 0 ? Math.max(0.1, bar.value / max) : 0.04) } as SparkStyle}
                />
              ))}
            </span>
          )}
        </footer>
      </article>
    </div>
  );
}
