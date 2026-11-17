import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlaylistsSection } from "../features/library/PlaylistsSection";
import { SavedTracksSection } from "../features/library/SavedTracksSection";
import {
  useLikedLibrary,
  useLikedTrackUris,
  usePlaylistLibrary,
  useRefreshLibrary,
} from "../features/library/libraryQueries";
import { useLikedLoadAll } from "../features/library/useLikedLoadAll";
import { LIKED_COLLECTION_URI } from "../features/library/libraryPresentation";
import { playLibraryContext, playLibraryTrack } from "../features/entities/entityPlayback";
import { usePlaybackActions } from "../features/playback/usePlayback";
import { usePlaybackEngine } from "../features/playback/usePlaybackEngine";
import { usePlaylistUsage } from "../features/home/usePlaylistUsage";
import { NewPlaylistButton } from "../features/playlists/NewPlaylistButton";
import { t } from "../i18n";
import { desktopApi } from "../services/desktopApi";

interface LibraryPageProps {
  likedOnly?: boolean;
}

export function LibraryPage({ likedOnly = false }: LibraryPageProps) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { playUri, playContext } = usePlaybackActions();
  const { localReady } = usePlaybackEngine();
  const playlists = usePlaylistLibrary(!likedOnly);
  const playlistUsage = usePlaylistUsage(!likedOnly);
  const liked = useLikedLibrary();
  const likedUris = useLikedTrackUris(!likedOnly);
  const refreshLibrary = useRefreshLibrary();
  const [refreshing, setRefreshing] = useState(false);
  const [optimisticallyRemoved, setOptimisticallyRemoved] = useState<Set<string>>(
    () => new Set(),
  );
  const mode = localReady ? "librespot" : "desktop";
  const save = useMutation({
    mutationFn: ({ uri, saved }: { uri: string; saved: boolean }) =>
      desktopApi.setTrackSaved(uri, saved),
    onMutate: ({ uri, saved }) => {
      setOptimisticallyRemoved((current) => {
        const next = new Set(current);
        if (saved) next.delete(uri);
        else next.add(uri);
        return next;
      });
    },
    onError: (_error, { uri, saved }) => {
      setOptimisticallyRemoved((current) => {
        const next = new Set(current);
        if (saved) next.add(uri);
        else next.delete(uri);
        return next;
      });
    },
    onSettled: () =>
      void client.invalidateQueries({ queryKey: ["library", "liked"] }),
  });
  const loadAllLiked = useLikedLoadAll(liked.remote);
  const likedTracks = (liked.view.data?.items ?? []).filter(
    (track) => !optimisticallyRemoved.has(track.uri),
  );
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        refreshLibrary(likedOnly),
        ...(likedOnly ? [] : [playlistUsage.refetch()]),
      ]);
    } finally {
      setRefreshing(false);
    }
  };
  const playLikedAll = () => {
    if (likedTracks.length === 0) return;
    playLibraryContext(LIKED_COLLECTION_URI, likedTracks, { playUri }, mode);
  };
  const playLikedTrackAt = (uri: string) => {
    const track = likedTracks.find((item) => item.uri === uri);
    if (!track) return;
    playLibraryTrack(
      track,
      { playUri, playContext },
      { uri: LIKED_COLLECTION_URI, tracks: likedTracks },
      mode,
    );
  };

  return (
    <div className="page library-page">
      <header className="page-heading split library-page-heading">
        <div className="library-heading-main">
          <h1>{likedOnly ? t("library.liked") : t("library.title")}</h1>
        </div>
        <div className="library-heading-actions">
          {!likedOnly && <NewPlaylistButton />}
          {likedOnly && likedTracks.length > 0 && (
            <button
              type="button"
              className="secondary-button library-play-all"
              onClick={playLikedAll}
            >
              <Play size={14} fill="currentColor" />
              {t("library.playAll")}
            </button>
          )}
          <button
            type="button"
            className="secondary-button library-refresh"
            disabled={refreshing}
            aria-busy={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} className={refreshing ? "is-spinning" : ""} />
            {refreshing ? t("library.refreshingShort") : t("library.refresh")}
          </button>
        </div>
      </header>

      {!likedOnly && (
        <PlaylistsSection
          data={playlists.view.data}
          usage={playlistUsage.data ?? []}
          usagePending={playlistUsage.isPending}
          phase={playlists.view.phase}
          hasNextPage={playlists.remote.hasNextPage}
          pending={playlists.remote.isFetchingNextPage}
          onLoadMore={() => void playlists.remote.fetchNextPage()}
          onOpenPlaylist={(item) =>
            navigate(`/playlist/${encodeURIComponent(item.uri)}`, { state: item })
          }
          onPlayPlaylist={(item) =>
            playLibraryContext(item.uri, undefined, { playUri }, mode)
          }
          liked={{
            count: likedUris.data?.length ?? liked.view.data?.total,
            onOpen: () => navigate("/liked"),
            onPlay: playLikedAll,
          }}
        />
      )}

      {likedOnly && (
        <SavedTracksSection
          data={liked.view.data}
          tracks={likedTracks}
          phase={liked.view.phase}
          hasNextPage={liked.remote.hasNextPage}
          pending={liked.remote.isFetchingNextPage}
          compactHeading
          onLoadMore={() => void liked.remote.fetchNextPage()}
          onNeedAll={loadAllLiked.request}
          loadingAll={loadAllLiked.active}
          onPlay={(uri) => playLikedTrackAt(uri)}
          onQueue={(uri) => void desktopApi.addToQueue(uri, likedTracks.find(track => track.uri === uri))}
          onSavedChange={(uri, saved) => save.mutate({ uri, saved })}
        />
      )}
    </div>
  );
}
