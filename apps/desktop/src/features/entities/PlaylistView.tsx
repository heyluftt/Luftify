import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MediaItem, PlaylistDetails } from "@luft/protocol-types";
import { Check, Database, LoaderCircle } from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { DetailHero } from "../../components/entity/DetailHero";
import { DetailPending } from "../../components/entity/DetailPending";
import { PlaylistSortControls } from "../../components/entity/PlaylistSortControls";
import { TrackList } from "../../components/TrackList";
import { desktopApi } from "../../services/desktopApi";
import {
  DEFAULT_PLAYLIST_SORT,
  readPlaylistSort,
  savePlaylistSort,
  sortPlaylistTracks,
  type PlaylistSort,
  type PlaylistSortField,
} from "../library/playlistSorting";
import { usePlayerStore } from "../../stores/playerStore";
import { usePlaybackActions } from "../playback/usePlayback";
import { playlistPlaybackSelection } from "./playlistPlayback";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { filterPlaylistTracks } from "./playlistFilter";
import {
  playlistHeroCover,
  playlistHeroOwner,
  playlistHeroSubtitle,
} from "./playlistHero";
import {
  canonicalPlaylistUri,
  playlistPlaceholderCount,
  preferPlaylistSnapshot,
  readyPlaylistTracks,
} from "./playlistSnapshot";
import { playlistLoadKind, playlistLoadLabel } from "./playlistLoadStatus";
import { withoutPlaylistTrack, withoutPlaylistUri } from "./playlistMutations";
import {
  preparePlaylistAssets,
  type PlaylistPreparationProgress,
} from "./playlistPreparation";
import type { EntityViewProps } from "./entityTypes";
import { t } from "../../i18n";
import { formatListeningTime } from "../analytics/analyticsFormatting";
import { AddToRoomButton } from "../listen-together/AddToRoomButton";
import { PlaylistManageActions } from "../playlists/PlaylistManageActions";
import { trackEntryKey, usePlaylistNews } from "../playlists/usePlaylistNews";
import { usePlaylistStanding } from "../playlists/usePlaylistActions";
import { usePlaylistPeople } from "../playlists/usePlaylistPeople";
import { PlaylistPeople, PlaylistPerson } from "../playlists/PlaylistPeople";
import { PlaylistCoverDialog } from "../playlists/PlaylistCoverDialog";

type PreparationState =
  | { phase: "idle" }
  | { phase: "running"; progress: PlaylistPreparationProgress }
  | { phase: "done"; tracks: number; unavailableTracks: number }
  | { phase: "error"; message: string };

export function PlaylistView({ uri, summary }: EntityViewProps) {
  const playlistUri = canonicalPlaylistUri(uri);
  const [coverOpen, setCoverOpen] = useState<string>();
  const [coverPreview, setCoverPreview] = useState<{ uri: string; image: string; previous: string | undefined }>();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { playContext, playUri } = usePlaybackActions();
  const { localReady: librespotReady, engineReady, mockMode } = usePlaybackEngine();
  const [sort, setSort] = useState<PlaylistSort>(() =>
    readPlaylistSort(playlistUri),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [preparation, setPreparation] = useState<PreparationState>({ phase: "idle" });
  const preparationAbort = useRef<AbortController | undefined>(undefined);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const focusRequest = useMemo(() => {
    // Back/forward restores the scroll position; only a fresh click jumps.
    if (navigationType === "POP") return undefined;
    const query = new URLSearchParams(location.search);
    const trackUri = query.get("nowPlaying");
    const requestId = query.get("focusRequest");
    return trackUri && requestId ? { trackUri, requestId } : undefined;
  }, [location.search, navigationType]);

  const canReadPlaylist = engineReady;
  const snapshotQueryKey = [
    "playlist-snapshot",
    librespotReady ? "librespot" : "desktop",
    playlistUri,
  ] as const;

  const cached = useQuery({
    queryKey: ["playlist-snapshot-cache", playlistUri],
    queryFn: () => desktopApi.cachedPlaylistSnapshot(uri),
    staleTime: Infinity,
    retry: false,
  });

  const query = useQuery({
    queryKey: snapshotQueryKey,
    queryFn: () => desktopApi.playlistSnapshot(uri),
    enabled: canReadPlaylist,
    staleTime: 2 * 60_000,
    // Never expose another playlist's tracks under the new playlist's actions.
    placeholderData: (previous) =>
      previous && canonicalPlaylistUri(previous.uri) === playlistUri
        ? previous
        : undefined,
    retry: 2,
    retryDelay: (attempt) => 700 * (attempt + 1),
    refetchInterval: (current) => {
      const details = current.state.data;
      if (!details) return false;
      const total = details.total ?? details.tracks.length;
      if (details.hasMore || details.tracks.length < total) {
        return current.state.dataUpdateCount > 15 ? false : 2_000;
      }
      if (playlistPlaceholderCount(details) === 0) return false;
      const repairAttempt = Math.max(0, current.state.dataUpdateCount - 1);
      if (repairAttempt >= 8) return false;
      return Math.min(20_000, 2_500 * (2 ** Math.min(repairAttempt, 3)));
    },
  });

  useEffect(() => {
    setSort(readPlaylistSort(playlistUri));
    setSearchQuery("");
    setPreparation({ phase: "idle" });
    preparationAbort.current?.abort();
  }, [playlistUri]);

  useEffect(() => () => preparationAbort.current?.abort(), []);

  useEffect(() => {
    if (focusRequest) setSearchQuery("");
  }, [focusRequest]);

  const details = preferPlaylistSnapshot(query.data, cached.data);
  const standing = usePlaylistStanding(playlistUri);
  const contributors = usePlaylistPeople(details);
  const shared = (details?.collaborative ?? standing.collaborative) || contributors.people.length > 1;
  const news = usePlaylistNews(playlistUri, details?.tracks ?? [], shared);
  const canEditCover = librespotReady && (standing.own || details?.canModify === true);
  const showingCached =
    details === cached.data && cached.data !== null && cached.data !== undefined;
  const visibleTracks = useMemo(() => {
    const filtered = filterPlaylistTracks(
      readyPlaylistTracks(details?.tracks ?? []),
      deferredSearchQuery,
    );
    return sortPlaylistTracks(filtered, sort);
  }, [deferredSearchQuery, details?.tracks, sort]);

  if (!details) {
    const waiting = query.isPending || cached.isPending || query.isFetching;
    return (
      <DetailPending
        summary={summary}
        kind={t("playlist.kind")}
        connected={engineReady}
        error={query.isError && !waiting && !cached.data}
        capabilityMissing={false}
      />
    );
  }

  const addedDatesUnavailable =
    sort.field === "addedAt" &&
    !details.hasMore &&
    details.tracks.length > 0 &&
    !details.tracks.some((track) => track.addedAt);

  const updateSort = (next: PlaylistSort) => {
    setSort(next);
    savePlaylistSort(playlistUri, next);
  };

  const selectSort = (field: PlaylistSortField) =>
    updateSort({
      field,
      direction: field === "addedAt" ? "desc" : "asc",
    });

  const toggleDirection = () =>
    updateSort({
      ...sort,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });

  const sortAddedAt = () =>
    updateSort(
      sort.field === "addedAt"
        ? {
            ...sort,
            direction: sort.direction === "asc" ? "desc" : "asc",
          }
        : DEFAULT_PLAYLIST_SORT,
    );

  const total = details.total ?? details.tracks.length;
  const loadKind = playlistLoadKind({
    fetching: query.isFetching,
    showingCached,
    details,
  });
  const loadLabel = playlistLoadLabel(loadKind);
  const normalizedSearch = searchQuery.trim();
  const playbackSelection = playlistPlaybackSelection(
    playlistUri, details, sort, deferredSearchQuery, visibleTracks,
  );
  const removeFromPlaylist = async (track: MediaItem) => {
    const liveKey = snapshotQueryKey;
    const cacheKey = ["playlist-snapshot-cache", playlistUri] as const;
    const previousLive = queryClient.getQueryData<PlaylistDetails>(liveKey);
    const previousCache = queryClient.getQueryData<PlaylistDetails>(cacheKey);
    // Libre deletes by URI (all occurrences); the desktop bridge by entry.
    const update = (current: PlaylistDetails | null | undefined) =>
      !current
        ? current
        : librespotReady
          ? withoutPlaylistUri(current, track.uri)
          : withoutPlaylistTrack(current, track);

    queryClient.setQueryData(liveKey, update);
    queryClient.setQueryData(cacheKey, update);

    try {
      await desktopApi.removeTrackFromPlaylist(
        playlistUri,
        track.playlistEntryId ?? "",
        track.uri,
      );
    } catch (error) {
      queryClient.setQueryData(liveKey, previousLive);
      queryClient.setQueryData(cacheKey, previousCache);
      throw error;
    }
  };

  const preparePlaylist = async () => {
    if (!librespotReady || preparation.phase === "running") return;
    preparationAbort.current?.abort();
    const abort = new AbortController();
    preparationAbort.current = abort;
    setPreparation({
      phase: "running",
      progress: { stage: "tracks", completed: 0, total },
    });
    try {
      const prepared = await preparePlaylistAssets(playlistUri, {
        signal: abort.signal,
        loadSnapshot: desktopApi.playlistSnapshot,
        loadCover: async (url) => {
          const cover = await desktopApi.coverData(url);
          queryClient.setQueryData(["cover", url], cover);
        },
        onSnapshot: (snapshot) => {
          queryClient.setQueryData(snapshotQueryKey, snapshot);
          queryClient.setQueryData(["playlist-snapshot-cache", playlistUri], snapshot);
        },
        onProgress: (progress) => setPreparation({ phase: "running", progress }),
      });
      if (!abort.signal.aborted) {
        setPreparation({
          phase: "done",
          tracks: prepared.preparedTracks,
          unavailableTracks: prepared.unavailableTracks,
        });
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        setPreparation({
          phase: "error",
          message: error instanceof Error ? error.message : t("playlist.preloadFailed"),
        });
      }
    }
  };

  const preparationLabel = preparation.phase === "running"
    ? t(preparation.progress.stage === "tracks" ? "playlist.preloadTracks" : "playlist.preloadCovers", {
        done: preparation.progress.completed,
        total: preparation.progress.total,
      })
    : preparation.phase === "done"
      ? t("playlist.preloaded")
      : preparation.phase === "error"
        ? t("playlist.preloadRetry")
        : t("playlist.preload");
  const totalDurationMs = details.tracks.reduce((sum, track) => sum + (track.durationMs ?? 0), 0);
  const trackCountLabel = t(total === 1 ? "libraryUi.trackCountOne" : "libraryUi.trackCount", { count: total });

  return (
    <>
      <DetailHero
        kind={t(shared ? "playlists.sharedKind" : "playlist.kind")}
        name={details.name}
        subtitle={playlistHeroSubtitle(
          shared
            ? (details.owner ? contributors.profileFor(details.owner)?.displayName : undefined)
            : playlistHeroOwner(details.ownerName, summary?.subtitle),
          // Duration only once every track is known, never a partial sum.
          totalDurationMs > 0 && !details.hasMore && details.tracks.length >= total
            ? `${trackCountLabel} · ${formatListeningTime(totalDurationMs)}`
            : trackCountLabel,
        )}
        image={coverPreview?.uri === playlistUri && (!details.coverUri || details.coverUri === coverPreview.previous) ? coverPreview.image : playlistHeroCover(
          details.coverUri,
          summary?.coverUri,
          details.tracks[0]?.coverUri,
        )}
        onImageContextMenu={canEditCover ? () => setCoverOpen(playlistUri) : undefined}
        onPlay={() => {
          if (librespotReady && deferredSearchQuery.trim() && !visibleTracks.length) return;
          const ordered = playbackSelection.tracks ?? sortPlaylistTracks(details.tracks, sort);
          const start = ordered[0]?.uri;
          if (librespotReady && start && !usePlayerStore.getState().playback?.shuffleEnabled) {
            playContext(playbackSelection.contextUri, start, playbackSelection.tracks);
            return;
          }
          playUri(librespotReady ? playbackSelection.contextUri : playlistUri, librespotReady ? playbackSelection.tracks : undefined);
        }}
        actions={<>
          <AddToRoomButton uri={playlistUri} name={details.name}
            tracks={playbackSelection.tracks ?? sortPlaylistTracks(details.tracks, sort)}
            complete={!details.hasMore && details.tracks.length >= total} />
          <PlaylistManageActions uri={playlistUri} name={details.name}
            onEditCover={canEditCover ? () => setCoverOpen(playlistUri) : undefined}
            coverUri={playlistHeroCover(details.coverUri, summary?.coverUri, details.tracks[0]?.coverUri)} />
          {librespotReady && (
          <div className="playlist-preparation">
            <button
              type="button"
              className="secondary-button"
              disabled={preparation.phase === "running"}
              aria-busy={preparation.phase === "running"}
              title={t("playlist.preloadHint")}
              onClick={() => void preparePlaylist()}
            >
              {preparation.phase === "running" ? (
                <LoaderCircle className="playlist-preparation-spinner" size={16} />
              ) : preparation.phase === "done" ? (
                <Check size={16} />
              ) : (
                <Database size={16} />
              )}
              {preparationLabel}
            </button>
            {preparation.phase === "error" && (
              <span className="playlist-preparation-status error" role="status">
                {preparation.message}
              </span>
            )}
            {preparation.phase === "done" && preparation.unavailableTracks > 0 && (
              <span className="playlist-preparation-status" role="status">
                {t("playlist.preloadSkipped", { done: preparation.tracks, skipped: preparation.unavailableTracks })}
              </span>
            )}
          </div>
          )}
          {shared && <PlaylistPeople people={contributors.people} profileFor={contributors.profileFor} complete={!details.hasMore && details.tracks.length >= total} />}
          {news.size > 0 && <span className="playlist-news" role="status">{t(news.size === 1 ? "playlists.newOne" : "playlists.newMany", { n: news.size })}</span>}
        </>}
        toolbar={(
          <>
            {loadLabel && (
              <span className="playlist-sort-progress">
                {loadKind === "refreshing" ? <Database size={13} /> : <LoaderCircle size={13} />}
                {loadLabel}
              </span>
            )}
            <PlaylistSortControls
              sort={sort}
              total={total}
              visibleTotal={visibleTracks.length}
              searchQuery={searchQuery}
              onSelect={selectSort}
              onToggleDirection={toggleDirection}
              onSearchQueryChange={setSearchQuery}
            />
          </>
        )}
      />

      {coverOpen === playlistUri && <PlaylistCoverDialog uri={playlistUri} image={coverPreview?.uri === playlistUri ? coverPreview.image : details.coverUri}
        onSaved={(image) => setCoverPreview({ uri: playlistUri, image, previous: details.coverUri })} onClose={() => setCoverOpen(undefined)} />}

      <section className="entity-tracks">
        {addedDatesUnavailable && (
          <div className="playlist-sort-note">
            {t("playlist.noAddedDates")}
          </div>
        )}

        <TrackList
          tracks={visibleTracks}
          renderAddedBy={shared ? (track) => <>
            <PlaylistPerson profile={track.addedBy ? contributors.profileFor(track.addedBy) : undefined} />
            {news.has(trackEntryKey(track)) && <i className="playlist-new-mark">{t("playlists.newMark")}</i>}
          </> : undefined}
          focusRequest={focusRequest}
          onPlay={(trackUri) => playContext(librespotReady ? playbackSelection.contextUri : playlistUri, trackUri, librespotReady ? playbackSelection.tracks : undefined)}
          onQueue={(trackUri) => void desktopApi.addToQueue(trackUri, visibleTracks.find(track => track.uri === trackUri))}
          onRemoveFromPlaylist={
            details.canModify === true
              ? removeFromPlaylist
              : undefined
          }
          empty={
            normalizedSearch
              ? t("playlist.noMatch", { query: normalizedSearch })
              : t("playlist.empty")
          }
          showAddedAt
          addedAtSortDirection={
            sort.field === "addedAt" ? sort.direction : undefined
          }
          onAddedAtSort={sortAddedAt}
        />
      </section>
    </>
  );
}
