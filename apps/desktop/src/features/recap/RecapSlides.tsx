import { Play } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { formatListeningTime, joinCreatorNames } from "../analytics/analyticsFormatting";
import type { AnalyticsCreator, AnalyticsTrack } from "../analytics/analyticsTypes";
import { formatRecapDate, recapAmount, recapChangeText, recapCount, recapPercent } from "./recapFormat";
import type { RecapFacts } from "./recapPlan";
import type { ListeningRecap, RecapPeriod } from "./recapTypes";
import { RecapActivityChart } from "./RecapCharts";
import { useCountUp } from "./useCountUp";

export interface RecapSlideProps {
  recap: ListeningRecap;
  period: RecapPeriod;
  facts: RecapFacts;
  /** The slide is on screen: animations and counters start. */
  active: boolean;
  artistImage: (creator: AnalyticsCreator) => string | undefined;
  playlistInfo: (uri: string) => { name?: string; coverUri?: string } | undefined;
  onPlayTrack: (track: AnalyticsTrack) => void;
}

/** Shared frame: eyebrow above, the story below, staggered entrance. */
export function SlideFrame({ eyebrow, children, className }: { eyebrow: string; children: ReactNode; className?: string }) {
  return (
    <div className={["recap-slide", className].filter(Boolean).join(" ")}>
      <p className="recap-eyebrow recap-enter" style={{ "--recap-delay": "0ms" } as CSSProperties}>{eyebrow}</p>
      {children}
    </div>
  );
}

export function delay(ms: number) {
  return { "--recap-delay": `${ms}ms` } as CSSProperties;
}

export function IntroSlide({ recap, period }: RecapSlideProps) {
  const covers = recap.overview.topTracks.slice(0, 4);
  return (
    <div className="recap-slide recap-intro">
      <div className="recap-intro-covers" aria-hidden="true">
        {covers.map((entry, index) => (
          <span key={entry.track.uri} className={`recap-intro-cover recap-intro-cover-${index}`}>
            <AlbumArt title={entry.track.title} image={entry.track.coverUri} size="large" priority />
          </span>
        ))}
      </div>
      <p className="recap-eyebrow recap-enter" style={delay(120)}>{period.eyebrow}</p>
      <h2 className="recap-intro-title recap-enter" style={delay(260)}>{period.title}</h2>
      <p className="recap-intro-dates recap-enter" style={delay(420)}>{period.dates}</p>
      {period.provisional && <p className="recap-note recap-enter" style={delay(520)}>{t("recap.provisional")}</p>}
      <p className="recap-intro-lead recap-enter" style={delay(700)}>{t("recap.intro.lead")}</p>
    </div>
  );
}

export function TimeSlide({ recap, period, facts, active }: RecapSlideProps) {
  const amount = recapAmount(recap.overview.totalListeningMs);
  const counted = useCountUp(amount.value, active);
  const change = recapChangeText(facts.change);
  return (
    <SlideFrame eyebrow={t("recap.time.lead")} className="recap-time">
      <p className="recap-big-number recap-enter" style={delay(150)}>
        <strong>{recapCount(counted)}</strong>
        <span>{amount.unit}</span>
      </p>
      {change && <p className={`recap-change recap-enter ${facts.change! >= 0 ? "is-up" : "is-down"}`} style={delay(500)}>{change}</p>}
      <div className="recap-facts recap-enter" style={delay(750)}>
        <span>{t("recap.time.days", { active: facts.activeDays, total: facts.periodDays })}</span>
        <span>{t("recap.time.plays", { n: recapCount(recap.overview.qualifiedPlayCount) })}</span>
      </div>
      <RecapActivityChart recap={recap} period={period} delayMs={900} />
    </SlideFrame>
  );
}

export function TopTrackSlide({ recap, period, onPlayTrack }: RecapSlideProps) {
  const top = recap.overview.topTracks[0]!;
  const firstHeard = recap.topTrackFirstHeardMs;
  return (
    <SlideFrame eyebrow={t("recap.topTrack.lead")} className="recap-top-track">
      <div className="recap-hero-cover recap-enter recap-pop" style={delay(150)}>
        <AlbumArt title={top.track.title} image={top.track.coverUri} size="feature" priority />
      </div>
      <h2 className="recap-headline recap-enter" style={delay(450)}>{top.track.title}</h2>
      <p className="recap-subline recap-enter" style={delay(560)}>{joinCreatorNames(top.track.creators)}</p>
      <div className="recap-facts recap-enter" style={delay(720)}>
        <span>{top.playCount === 1 ? t("recap.topTrack.playsOne") : t("recap.topTrack.plays", { n: recapCount(top.playCount) })}</span>
        <span>{t("recap.topTrack.total", { time: formatListeningTime(top.listeningMs) })}</span>
        {firstHeard != null && (
          <span>{t(firstHeard < period.fromMs ? "recap.topTrack.since" : "recap.topTrack.found", { date: formatRecapDate(firstHeard) })}</span>
        )}
      </div>
      <button type="button" className="recap-action recap-enter" style={delay(880)} onClick={(event) => { event.stopPropagation(); onPlayTrack(top.track); }}>
        <Play size={15} fill="currentColor" aria-hidden="true" />{t("recap.play")}
      </button>
    </SlideFrame>
  );
}

export function TopTracksSlide({ recap, onPlayTrack }: RecapSlideProps) {
  const tracks = recap.overview.topTracks.slice(0, 5);
  return (
    <SlideFrame eyebrow={t("recap.topTracks.lead")} className="recap-ranking">
      <ol className="recap-list">
        {tracks.map((entry, index) => (
          <li key={entry.track.uri} className="recap-enter" style={delay(160 + index * 130)}>
            <button type="button" onClick={(event) => { event.stopPropagation(); onPlayTrack(entry.track); }}>
              <span className="recap-rank">{index + 1}</span>
              <AlbumArt title={entry.track.title} image={entry.track.coverUri} size="small" priority />
              <span className="recap-list-copy">
                <strong>{entry.track.title}</strong>
                <small>{joinCreatorNames(entry.track.creators)}</small>
              </span>
              <span className="recap-list-meta">{t("recap.topTracks.plays", { n: recapCount(entry.playCount) })}</span>
            </button>
          </li>
        ))}
      </ol>
    </SlideFrame>
  );
}

export function TopArtistSlide({ recap, facts, artistImage }: RecapSlideProps) {
  const [top, ...rest] = recap.overview.topArtists.slice(0, 5);
  if (!top) return null;
  const image = artistImage(top.creator);
  return (
    <SlideFrame eyebrow={t("recap.topArtist.lead")} className="recap-top-artist">
      <div className="recap-artist-portrait recap-enter recap-pop" style={delay(150)}>
        <AlbumArt title={top.creator.name} image={image} size="feature" priority />
      </div>
      <h2 className="recap-headline recap-enter" style={delay(420)}>{top.creator.name}</h2>
      <div className="recap-facts recap-enter" style={delay(560)}>
        <span>{t("recap.topArtist.time", { time: formatListeningTime(top.listeningMs) })}</span>
        {facts.topArtistShare !== undefined && <span>{t("recap.topArtist.share", { pct: recapPercent(facts.topArtistShare) })}</span>}
      </div>
      {rest.length > 0 && (
        <div className="recap-runners recap-enter" style={delay(760)}>
          <small>{t("recap.topArtists.more")}</small>
          <ol>
            {rest.map((artist, index) => (
              <li key={artist.creator.uri ?? artist.creator.name}><span>{index + 2}</span>{artist.creator.name}</li>
            ))}
          </ol>
        </div>
      )}
    </SlideFrame>
  );
}
