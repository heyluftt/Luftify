import { CalendarDays, Clock3, Flame, ListMusic, Disc3, Play, Sparkles } from "lucide-react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { formatListeningTime, joinCreatorNames } from "../analytics/analyticsFormatting";
import { formatRecapDay, recapCount, recapPeakHour, recapPersona, recapTaste } from "./recapFormat";
import { SlideFrame, delay, type RecapSlideProps } from "./RecapSlides";
import { useCountUp } from "./useCountUp";
import { RecapHourChart } from "./RecapCharts";

export function DiscoveriesSlide({ recap, active, artistImage, onPlayTrack }: RecapSlideProps) {
  const artists = useCountUp(recap.newArtistCount, active, 1_100);
  const top = recap.topNewArtist;
  const discovery = recap.topDiscovery;
  const image = top ? artistImage(top.creator) : undefined;
  return (
    <SlideFrame eyebrow={t("recap.discoveries.lead")} className="recap-discoveries">
      <span className="recap-icon recap-enter recap-pop" style={delay(120)} aria-hidden="true"><Sparkles size={34} /></span>
      <h2 className="recap-headline recap-enter" style={delay(300)}>
        {recap.newArtistCount === 1 ? t("recap.discoveries.artistsOne") : t("recap.discoveries.artists", { n: recapCount(artists) })}
      </h2>
      {recap.newTrackCount > 0 && (
        <p className="recap-subline recap-enter" style={delay(440)}>
          {recap.newTrackCount === 1 ? t("recap.discoveries.tracksOne") : t("recap.discoveries.tracks", { n: recapCount(recap.newTrackCount) })}
        </p>
      )}
      <div className="recap-chips">
        {top && (
          <div className="recap-chip recap-enter" style={delay(640)}>
            <span className="recap-chip-image"><AlbumArt title={top.creator.name} image={image} size="tiny" priority /></span>
            <span>{t("recap.discoveries.top", { name: top.creator.name })}</span>
          </div>
        )}
        {discovery && (
          <button type="button" className="recap-chip is-song recap-enter" style={delay(780)} onClick={(event) => { event.stopPropagation(); onPlayTrack(discovery.track); }}>
            <span className="recap-chip-image is-square"><AlbumArt title={discovery.track.title} image={discovery.track.coverUri} size="tiny" priority /></span>
            <span>{t("recap.discoveries.song", { title: discovery.track.title })}</span>
            <Play size={13} fill="currentColor" aria-hidden="true" />
          </button>
        )}
      </div>
    </SlideFrame>
  );
}

export function OnRepeatSlide({ recap, onPlayTrack }: RecapSlideProps) {
  const repeat = recap.onRepeat;
  if (!repeat) return null;
  return (
    <SlideFrame eyebrow={t("recap.onRepeat.lead")} className="recap-on-repeat">
      <div className="recap-repeat-stack recap-enter recap-pop" style={delay(150)} aria-hidden="true">
        {[2, 1, 0].map((layer) => (
          <span key={layer} className={`recap-repeat-layer recap-repeat-layer-${layer}`}>
            <AlbumArt title={repeat.track.title} image={repeat.track.coverUri} size="large" priority />
          </span>
        ))}
      </div>
      <h2 className="recap-headline recap-enter" style={delay(420)}>{repeat.track.title}</h2>
      <p className="recap-subline recap-enter" style={delay(520)}>{joinCreatorNames(repeat.track.creators)}</p>
      <p className="recap-statement recap-enter" style={delay(700)}>
        <Flame size={16} aria-hidden="true" />
        {t("recap.onRepeat.text", { day: formatRecapDay(repeat.dayStartMs), n: recapCount(repeat.playCount) })}
      </p>
      <button type="button" className="recap-action recap-enter" style={delay(860)} onClick={(event) => { event.stopPropagation(); onPlayTrack(repeat.track); }}>
        {t("recap.play")}
      </button>
    </SlideFrame>
  );
}

export function RhythmSlide({ recap, facts }: RecapSlideProps) {
  const peak = recapPeakHour(facts);
  return (
    <SlideFrame eyebrow={t("recap.rhythm.lead")} className="recap-rhythm">
      <h2 className="recap-persona recap-enter recap-pop" style={delay(180)}>{recapPersona(facts)}</h2>
      <p className="recap-subline recap-enter" style={delay(420)}>{recapTaste(facts)}</p>
      <RecapHourChart recap={recap} peakHour={facts.peakHour} delayMs={520} />
      <ul className="recap-stat-list">
        {peak && <li className="recap-enter" style={delay(600)}><Clock3 size={16} aria-hidden="true" />{peak}</li>}
        {facts.longestStreak >= 2 && (
          <li className="recap-enter" style={delay(720)}><Flame size={16} aria-hidden="true" />{t("recap.rhythm.streak", { n: facts.longestStreak })}</li>
        )}
        {facts.busiestDay && (
          <li className="recap-enter" style={delay(840)}>
            <CalendarDays size={16} aria-hidden="true" />
            {t("recap.rhythm.busiest", { day: formatRecapDay(facts.busiestDay.dayStartMs) })} · {formatListeningTime(facts.busiestDay.listeningMs)}
          </li>
        )}
      </ul>
    </SlideFrame>
  );
}

export function PlacesSlide({ recap, playlistInfo }: RecapSlideProps) {
  const playlist = recap.overview.topPlaylists[0];
  const info = playlist ? playlistInfo(playlist.playlistUri) : undefined;
  const album = recap.topAlbum;
  return (
    <SlideFrame eyebrow={t("recap.places.lead")} className="recap-places">
      <div className="recap-place-cards">
        {playlist && (
          <div className="recap-place recap-enter recap-pop" style={delay(180)}>
            <AlbumArt title={info?.name ?? playlist.playlistName ?? ""} image={info?.coverUri} size="large" priority />
            <small><ListMusic size={13} aria-hidden="true" />{t("recap.places.playlist")}</small>
            <strong>{info?.name ?? playlist.playlistName ?? "—"}</strong>
            <span>{formatListeningTime(playlist.listeningMs)}</span>
          </div>
        )}
        {album && (
          <div className="recap-place recap-enter recap-pop" style={delay(380)}>
            <AlbumArt title={album.albumName} image={album.coverUri ?? undefined} size="large" priority />
            <small><Disc3 size={13} aria-hidden="true" />{t("recap.places.album")}</small>
            <strong>{album.albumName}</strong>
            <span>{[album.artistName, formatListeningTime(album.listeningMs)].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      </div>
    </SlideFrame>
  );
}
