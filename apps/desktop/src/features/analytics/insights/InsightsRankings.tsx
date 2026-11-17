import { UserRound } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { AlbumArt } from "../../../components/AlbumArt";
import { t } from "../../../i18n";
import { formatListeningTime, formatPlays, joinCreatorNames } from "../analyticsFormatting";
import type { AnalyticsTrack, ListeningOverview } from "../analyticsTypes";
import { analyticsArtistDisplayKey, type AnalyticsArtistDisplay } from "../useAnalyticsArtistDisplays";

type Kind = "songs" | "artists" | "playlists";

interface Row {
  key: string;
  title: string;
  subtitle: string;
  art: ReactNode;
  listeningMs: number;
  onSelect?: () => void;
  action: string;
}

/**
 * The top ten of the range in one place: songs, artists or playlists, each
 * row with a bar for its share of the leader.
 */
export function InsightsRankings({ overview, artistDisplays, playlistDetails, onPlayTrack, onOpenArtist, onOpenPlaylist }: {
  overview: ListeningOverview;
  artistDisplays: ReadonlyMap<string, AnalyticsArtistDisplay>;
  playlistDetails: ReadonlyMap<string, { name?: string; coverUri?: string }>;
  onPlayTrack: (track: AnalyticsTrack) => void;
  onOpenArtist: (uri: string) => void;
  onOpenPlaylist: (uri: string) => void;
}) {
  const [kind, setKind] = useState<Kind>("songs");
  const rows: Record<Kind, Row[]> = {
    songs: overview.topTracks.map((entry) => ({
      key: entry.track.uri,
      title: entry.track.title,
      subtitle: joinCreatorNames(entry.track.creators),
      art: <AlbumArt title={entry.track.title} image={entry.track.coverUri ?? undefined} size="tiny" />,
      listeningMs: entry.listeningMs,
      onSelect: () => onPlayTrack(entry.track),
      action: t("analytics.playTrack", { title: entry.track.title }),
    })),
    artists: overview.topArtists.map((entry, index) => {
      const display = artistDisplays.get(analyticsArtistDisplayKey(entry.creator));
      const uri = display?.uri ?? entry.creator.uri;
      return {
        key: `${entry.creator.uri ?? entry.creator.name}-${index}`,
        title: entry.creator.name,
        subtitle: formatPlays(entry.playCount),
        art: <span className="insights-rank-avatar">{display?.imageUri
          ? <AlbumArt title={entry.creator.name} image={display.imageUri} size="tiny" />
          : <UserRound size={16} aria-hidden="true" />}</span>,
        listeningMs: entry.listeningMs,
        ...(uri ? { onSelect: () => onOpenArtist(uri) } : {}),
        action: entry.creator.name,
      };
    }),
    playlists: overview.topPlaylists.map((entry) => {
      const details = playlistDetails.get(entry.playlistUri);
      const name = entry.playlistName || details?.name || t("analytics.unknownPlaylist");
      return {
        key: entry.playlistUri,
        title: name,
        subtitle: formatPlays(entry.playCount),
        art: <AlbumArt title={name} image={details?.coverUri ?? undefined} size="tiny" />,
        listeningMs: entry.listeningMs,
        onSelect: () => onOpenPlaylist(entry.playlistUri),
        action: name,
      };
    }),
  };
  // "Top 10": pictures are fetched for these ten.
  const shown = rows[kind].slice(0, 10);
  const leader = Math.max(1, shown[0]?.listeningMs ?? 1);
  const tabs: { key: Kind; label: string }[] = [
    { key: "songs", label: t("analytics.songs") },
    { key: "artists", label: t("analytics.artists") },
    { key: "playlists", label: t("library.playlists") },
  ];

  return (
    <section className="insights-card insights-rankings" aria-labelledby="insights-rankings-title">
      <header className="insights-card-head">
        <h2 id="insights-rankings-title">{t("analytics.topTen")}</h2>
        <div className="insights-tabs" role="tablist" aria-label={t("analytics.rankingsAria")}>
          {tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={kind === tab.key} onClick={() => setKind(tab.key)}>{tab.label}</button>)}
        </div>
      </header>
      {shown.length ? <ol className="insights-rank-list" role="tabpanel">
        {shown.map((row, index) => {
          const content = <>
            <span className="insights-rank-number">{index + 1}</span>
            <span className="insights-rank-art">{row.art}</span>
            <span className="insights-rank-copy"><strong>{row.title}</strong><small>{row.subtitle}</small></span>
            <span className="insights-rank-time">{formatListeningTime(row.listeningMs)}</span>
            <i className="insights-rank-bar" style={{ "--share": row.listeningMs / leader } as CSSProperties} aria-hidden="true" />
          </>;
          return <li key={row.key} style={{ "--i": index } as CSSProperties}>
            {row.onSelect
              ? <button type="button" className="insights-rank-row" onClick={row.onSelect} aria-label={row.action}>{content}</button>
              : <div className="insights-rank-row">{content}</div>}
          </li>;
        })}
      </ol> : <p className="insights-chart-empty">{t(kind === "songs" ? "analytics.noSongs" : kind === "artists" ? "analytics.noArtists" : "analytics.noPlaylists")}</p>}
    </section>
  );
}
