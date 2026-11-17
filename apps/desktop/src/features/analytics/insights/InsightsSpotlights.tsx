import { ArrowRight, Play, UserRound } from "lucide-react";
import { AlbumArt } from "../../../components/AlbumArt";
import { t } from "../../../i18n";
import { useCoverPalette } from "../../recap/page/useCoverPalette";
import { formatListeningTime, formatPlays, formatPercentage, joinCreatorNames } from "../analyticsFormatting";
import type { AnalyticsTrack, ListeningOverview } from "../analyticsTypes";
import { analyticsArtistDisplayKey, type AnalyticsArtistDisplay } from "../useAnalyticsArtistDisplays";

/** The range's number-one song and artist. */
export function InsightsSpotlights({ overview, artistDisplays, onPlayTrack, onOpenArtist }: {
  overview: ListeningOverview;
  artistDisplays: ReadonlyMap<string, AnalyticsArtistDisplay>;
  onPlayTrack: (track: AnalyticsTrack) => void;
  onOpenArtist: (uri: string) => void;
}) {
  const song = overview.topTracks[0];
  const artist = overview.topArtists[0];
  const display = artist ? artistDisplays.get(analyticsArtistDisplayKey(artist.creator)) : undefined;
  const artistUri = display?.uri ?? artist?.creator.uri;
  const { style } = useCoverPalette(song?.track.coverUri);
  const share = (listeningMs: number) => overview.totalListeningMs > 0
    ? ` · ${t("analytics.ofListening", { pct: formatPercentage(listeningMs / overview.totalListeningMs) })}` : "";
  if (!song && !artist) return null;

  return (
    <section className="insights-spotlights" aria-label={t("analytics.spotlightsAria")}>
      {song && <article className="insights-spot insights-spot-song" style={style}>
        <span className="insights-spot-backdrop" aria-hidden="true"><AlbumArt title="" image={song.track.coverUri ?? undefined} size="medium" /></span>
        <span className="insights-spot-cover"><AlbumArt title={song.track.title} image={song.track.coverUri ?? undefined} size="large" priority /></span>
        <div className="insights-spot-copy">
          <span className="insights-spot-label">{t("analytics.topTrack")}</span>
          <h3>{song.track.title}</h3>
          <p>{joinCreatorNames(song.track.creators)}</p>
          <small>{formatPlays(song.playCount)} · {formatListeningTime(song.listeningMs)}{share(song.listeningMs)}</small>
        </div>
        <button type="button" className="insights-spot-action" onClick={() => onPlayTrack(song.track)} aria-label={t("analytics.playTrack", { title: song.track.title })}>
          <Play size={16} fill="currentColor" aria-hidden="true" />
        </button>
      </article>}

      {artist && <article className="insights-spot insights-spot-artist">
        <span className="insights-spot-portrait">
          {display?.imageUri ? <AlbumArt title={artist.creator.name} image={display.imageUri} size="large" priority />
            : <span aria-hidden="true"><UserRound size={30} /></span>}
        </span>
        <div className="insights-spot-copy">
          <span className="insights-spot-label">{t("analytics.topArtist")}</span>
          <h3>{artist.creator.name}</h3>
          <p>{formatPlays(artist.playCount)} · {formatListeningTime(artist.listeningMs)}</p>
          <small>{share(artist.listeningMs).replace(/^ · /, "")}</small>
        </div>
        {artistUri && <button type="button" className="insights-spot-action is-quiet" onClick={() => onOpenArtist(artistUri)}
          aria-label={t("analytics.openArtist")} title={t("analytics.openArtist")}>
          <ArrowRight size={16} aria-hidden="true" />
        </button>}
      </article>}
    </section>
  );
}
