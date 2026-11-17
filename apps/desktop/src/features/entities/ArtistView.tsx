import { t } from "../../i18n";
import { DetailHero } from "../../components/entity/DetailHero";
import { useQuery } from "@tanstack/react-query";
import { TrackList } from "../../components/TrackList";
import { desktopApi } from "../../services/desktopApi";
import { usePlaybackActions, usePlaybackConnected } from "../playback/usePlayback";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { playLibraryContext, playLibraryTrack } from "./entityPlayback";
import { usePlayerStore } from "../../stores/playerStore";
import { ArtistDiscographyNotice } from "./artist/ArtistDiscographyNotice";
import { ArtistProfileStatus } from "./artist/ArtistProfileStatus";
import { ArtistReleaseSection } from "./artist/ArtistReleaseSection";
import {
  artistDiscographyIssues,
  artistProfileStats,
  artistProfilePartialKind,
  ARTIST_PROFILE_QUERY_VERSION,
  hasArtistContent,
  normalizeArtistDetails,
  uniqueReleases,
} from "./artist/artistProfileModel";
import type { EntityViewProps } from "./entityTypes";

export function ArtistView({ uri, summary }: EntityViewProps) {
  const connected = usePlaybackConnected();
  const playback = usePlaybackActions();
  const connectionEpoch = usePlayerStore((store) => store.connectionEpoch);
  const { localReady: librespotReady, engineReady, mockMode } = usePlaybackEngine();
  const canReadArtist = engineReady;

  const query = useQuery({
    queryKey: [
      "artist-profile",
      ARTIST_PROFILE_QUERY_VERSION,
      connectionEpoch,
      librespotReady ? "librespot" : "desktop",
      uri,
    ],
    queryFn: async () =>
      normalizeArtistDetails(await desktopApi.artist(uri), uri),
    enabled: canReadArtist,
    staleTime: 2 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: "always",
    retry: 1,
    retryDelay: 350,
  });
  const details = query.data;
  const artistName = details?.name || summary?.name || t("artist.fallbackName");
  const artistImage = details?.imageUri || summary?.coverUri;

  if (!details) {
    const statusKind = query.isError
      ? "error"
      : canReadArtist
        ? "loading"
        : "connecting";

    return (
      <div className="artist-profile-page">
        <DetailHero
          round
          kind={t("entity.artist")}
          name={artistName}
          image={artistImage}
          subtitle={statusKind === "connecting" || statusKind === "loading" ? t("artist.loadingData") : t("artist.sessionNote")}
        />
        <ArtistProfileStatus
          kind={statusKind}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const albums = uniqueReleases(details.albums);
  const singles = uniqueReleases(details.singles);
  const compilations = uniqueReleases(details.compilations);
  const discographyIssues = artistDiscographyIssues(details);
  const partialKind = artistProfilePartialKind(details);
  const hasAlbums = details.popularTracks.some(
    (track) => Boolean(track.albumName),
  );
  const hasDurations = details.popularTracks.some(
    (track) => typeof track.durationMs === "number",
  );

  return (
    <div className="artist-profile-page">
      <DetailHero
        round
        kind={t("entity.artist")}
        name={artistName}
        image={artistImage}
        subtitle={artistProfileStats(details).map((stat) => `${stat.value} ${stat.label}`).join(" · ") || t("artist.sessionNote")}
        onPlay={
          connected || mockMode
            ? () => playLibraryContext(
                details.uri || uri,
                details.popularTracks,
                playback,
                librespotReady ? "librespot" : "desktop",
              )
            : undefined
        }
      />

      {partialKind && (
        <ArtistProfileStatus
          kind={partialKind}
          onRetry={() => void query.refetch()}
        />
      )}

      <ArtistDiscographyNotice
        issues={discographyIssues}
        onRetry={() => void query.refetch()}
      />

      {details.popularTracks.length > 0 && (
        <section className="section-block artist-track-section">
          <div className="section-title">
            <h2>{t("artist.popular")}</h2>
          </div>

          <TrackList
            tracks={details.popularTracks}
            onPlay={(trackUri) => playLibraryTrack(
              { uri: trackUri },
              playback,
              {
                uri: details.uri || uri,
                tracks: details.popularTracks,
              },
              librespotReady ? "librespot" : "desktop",
            )}
            onQueue={(trackUri) => void desktopApi.addToQueue(trackUri, details.popularTracks.find(track => track.uri === trackUri))}
            empty={t("artist.popularEmpty")}
            showAlbum={hasAlbums}
            showDuration={hasDurations}
          />
        </section>
      )}

      <ArtistReleaseSection title={t("artist.albums")} releases={albums} fallbackType="artist.type.album" />
      <ArtistReleaseSection title={t("artist.singles")} releases={singles} fallbackType="artist.type.single" />
      <ArtistReleaseSection title={t("artist.compilations")} releases={compilations} fallbackType="artist.type.compilation" />

      {!hasArtistContent(details) && (
        <section className="ds-state artist-profile-empty">
          <h2>{t("artist.empty")}</h2>
        </section>
      )}
    </div>
  );
}
