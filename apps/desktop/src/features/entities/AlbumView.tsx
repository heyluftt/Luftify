import { t } from "../../i18n";
import { useInfiniteQuery } from "@tanstack/react-query";
import { DetailHero } from "../../components/entity/DetailHero";
import { AddToRoomButton } from "../listen-together/AddToRoomButton";
import { DetailPending } from "../../components/entity/DetailPending";
import { LoadMore } from "../../components/entity/LoadMore";
import { TrackList } from "../../components/TrackList";
import { usePlaybackActions } from "../playback/usePlayback";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { playLibraryContext } from "./entityPlayback";
import { desktopApi } from "../../services/desktopApi";
import { nextPageOffset } from "../pagination";
import { combineAlbumPages } from "./entityPagination";
import type { EntityViewProps } from "./entityTypes";

export function AlbumView({ uri, summary }: EntityViewProps) {
  const { playContext, playUri } = usePlaybackActions();
  const { localReady: librespotReady, engineReady } = usePlaybackEngine();
  const canReadAlbum = engineReady;
  const query = useInfiniteQuery({
    queryKey: ["album", librespotReady ? "librespot" : "desktop", uri],
    queryFn: ({ pageParam }) =>
      desktopApi.album(uri, { offset: pageParam, limit: 50 }),
    initialPageParam: 0,
    getNextPageParam: nextPageOffset,
    enabled: canReadAlbum,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const details = combineAlbumPages(query.data?.pages);

  if (!details) {
    return (
      <DetailPending
        summary={summary}
        kind={t("entity.album")}
        connected={engineReady}
        error={query.isError}
      />
    );
  }

  const trackTotal = details.total ?? details.tracks.length;
  const subtitle = [
    details.artists.map((artist) => artist.name).join(", "),
    details.year,
    t(trackTotal === 1 ? "libraryUi.trackCountOne" : "libraryUi.trackCount", { count: trackTotal }),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <DetailHero
        kind={t("entity.album")}
        name={details.name}
        subtitle={subtitle}
        image={details.coverUri}
        onPlay={() => playLibraryContext(
          uri,
          details.tracks,
          { playUri },
          librespotReady ? "librespot" : "desktop",
        )}
        actions={<AddToRoomButton uri={uri} name={details.name} tracks={details.tracks} complete={!query.hasNextPage} />}
      />

      <section className="entity-tracks">
        <TrackList
          tracks={details.tracks}
          onPlay={(trackUri) => playContext(
            uri,
            trackUri,
            librespotReady ? details.tracks : undefined,
          )}
          onQueue={(trackUri) => void desktopApi.addToQueue(trackUri, details.tracks.find(track => track.uri === trackUri))}
          empty={t("entity.albumEmpty")}
        />

        {query.hasNextPage && (
          <LoadMore
            pending={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          />
        )}
      </section>
    </>
  );
}
