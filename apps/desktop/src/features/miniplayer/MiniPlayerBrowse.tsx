import type { EntitySummary } from "@luft/protocol-types";
import { Heart, Play, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { playLibraryContext } from "../entities/entityPlayback";
import { usePlaylistUsage } from "../home/usePlaylistUsage";
import { LIKED_COLLECTION_URI, filterPlaylists, formatTrackCount, sortPlaylists } from "../library/libraryPresentation";
import { useLikedLibrary, useLikedTrackUris, usePlaylistLibrary } from "../library/libraryQueries";
import { usePlayback } from "../playback/usePlayback";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { useQueueController } from "../queue/useQueueController";
import { isIncompleteQueueItem, sanitizeQueueState } from "../queue/sanitizeQueue";
import { matchesEveryWord } from "../textMatch";

export type MiniPlayerPanel = "queue" | "playlists";

/** Rows asked to resolve their titles at once; more follow while scrolling. */
const HYDRATE_AHEAD = 30;

export function MiniPlayerBrowse({ panel, close }: { panel: MiniPlayerPanel; close: () => void }) {
  const [query, setQuery] = useState("");
  const filter = useRef<HTMLInputElement>(null);
  const title = t(panel === "queue" ? "miniplayer.queue" : "library.playlists");
  // Focus once the window has grown, and without scrolling: an autofocus
  // while the window was still small scrolled the whole player out of view.
  useEffect(() => {
    if (panel !== "playlists") return;
    const frame = window.requestAnimationFrame(() => filter.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [panel]);
  return (
    <section className="miniplayer-browse" aria-label={title}>
      <header>
        <strong>{title}</strong>
        {panel === "playlists" && (
          <label className="miniplayer-filter">
            <Search size={11} aria-hidden="true" />
            <input
              ref={filter}
              value={query}
              maxLength={60}
              autoComplete="off"
              spellCheck={false}
              aria-label={t("miniplayerUi.filterPlaylists")}
              placeholder={t("library.filter")}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        )}
        <button type="button" aria-label={t("miniplayer.closePanel")} title={t("miniplayer.closePanel")} onClick={close}><X size={13} /></button>
      </header>
      <div className="miniplayer-browse-list">
        {panel === "queue" ? <QueueList /> : <PlaylistList query={query} close={close} />}
      </div>
    </section>
  );
}

function QueueList() {
  const { playback } = usePlayback();
  const controller = useQueueController(true, 3_000);
  const { connected, queue, loadTitles, loadMore, play } = controller;
  const items = queue.data ? sanitizeQueueState(queue.data, playback?.currentItem).items : [];
  const current = playback?.currentItem;
  const requested = useRef(new Set<string>());

  // Placeholders beyond the first page only get titles when asked for.
  const visibleMissing = items
    .slice(0, HYDRATE_AHEAD)
    .filter(({ item }) => isIncompleteQueueItem(item) && !requested.current.has(item.uri))
    .map(({ item }) => item.uri);
  const missingKey = visibleMissing.join(",");
  useEffect(() => {
    if (!loadTitles || !missingKey) return;
    const uris = missingKey.split(",");
    uris.forEach((uri) => requested.current.add(uri));
    loadTitles(uris);
  }, [loadTitles, missingKey]);

  if (!connected) return <p>{t("miniplayer.unavailable")}</p>;
  if (queue.isLoading) return <p>{t("miniplayer.loading")}</p>;
  if (queue.isError) return <p>{t("miniplayer.loadError")} <button type="button" onClick={() => void queue.refetch()}>{t("miniplayer.retry")}</button></p>;

  return (
    <ol>
      {current && (
        <li className="is-current">
          <span className="miniplayer-row-art"><AlbumArt title={current.title} size="tiny" image={current.coverUri} /></span>
          <span className="miniplayer-row-copy">
            <strong>{current.title}</strong>
            <small>{t("miniplayerUi.nowPlaying")}</small>
          </span>
        </li>
      )}
      {items.length === 0 && <li className="is-empty">{t("miniplayer.emptyQueue")}</li>}
      {items.map(({ item, uid }, index) => {
        const incomplete = isIncompleteQueueItem(item);
        return (
          <li key={uid ?? `${item.uri}-${index}`}>
            <button
              type="button"
              className="miniplayer-queue-row"
              disabled={incomplete}
              aria-label={t("miniplayerUi.playItem", { title: item.title })}
              onClick={() => void play(item.uri)}
            >
              <span className="miniplayer-row-number">{index + 1}</span>
              <span className="miniplayer-row-copy">
                <strong>{incomplete ? t("miniplayer.loading") : item.title}</strong>
                <small>{item.creators.map((creator) => creator.name).join(", ")}</small>
              </span>
              <Play size={11} fill="currentColor" aria-hidden="true" />
            </button>
          </li>
        );
      })}
      {loadMore && queue.data?.totalItems !== undefined && queue.data.totalItems > items.length && (
        <li className="is-empty">
          <button type="button" className="miniplayer-load-more" onClick={loadMore}>{t("miniplayer.more")}</button>
        </li>
      )}
    </ol>
  );
}

function PlaylistList({ query, close }: { query: string; close: () => void }) {
  const { view, remote } = usePlaylistLibrary();
  const usage = usePlaylistUsage();
  const liked = useLikedLibrary();
  const likedUris = useLikedTrackUris();
  const { connected, playUri } = usePlayback();
  const { localReady } = usePlaybackEngine();
  const mode = localReady ? "librespot" : "desktop";
  const items = useMemo(
    () => sortPlaylists(filterPlaylists(view.data?.items ?? [], query), "smart", usage.data ?? []),
    [query, usage.data, view.data],
  );
  const likedCount = likedUris.data?.length ?? liked.view.data?.total;
  const showLiked = matchesEveryWord(query, t("library.liked")) && likedCount !== 0;

  const playPlaylist = (playlist: EntitySummary) => {
    playLibraryContext(playlist.uri, undefined, { playUri }, mode);
    close();
  };
  const playLiked = () => {
    playLibraryContext(LIKED_COLLECTION_URI, liked.view.data?.items, { playUri }, mode);
    close();
  };

  if (!view.data && !showLiked) {
    return (
      <p>
        {remote.isFetching ? t("miniplayer.loading") : remote.isError ? t("miniplayer.loadError") : t("miniplayer.emptyPlaylists")}
        {remote.isError && <button type="button" onClick={() => void remote.refetch()}>{t("miniplayer.retry")}</button>}
      </p>
    );
  }
  return (
    <>
      {showLiked && (
        <button type="button" className="miniplayer-playlist-row" disabled={!connected} aria-label={t("miniplayerUi.playItem", { title: t("library.liked") })} onClick={playLiked}>
          <span className="miniplayer-row-art miniplayer-liked-art"><Heart size={12} fill="currentColor" /></span>
          <span className="miniplayer-row-copy">
            <strong>{t("library.liked")}</strong>
            {likedCount !== undefined && <small>{formatTrackCount(likedCount)}</small>}
          </span>
          <Play size={11} fill="currentColor" aria-hidden="true" />
        </button>
      )}
      {items.map((playlist) => (
        <button type="button" className="miniplayer-playlist-row" key={playlist.uri} disabled={!connected} aria-label={t("miniplayerUi.playItem", { title: playlist.name })} onClick={() => playPlaylist(playlist)}>
          <span className="miniplayer-row-art"><AlbumArt title={playlist.name} size="tiny" image={playlist.coverUri} /></span>
          <span className="miniplayer-row-copy">
            <strong>{playlist.name}</strong>
            {playlist.library?.trackCount !== undefined && <small>{formatTrackCount(playlist.library.trackCount)}</small>}
          </span>
          <Play size={11} fill="currentColor" aria-hidden="true" />
        </button>
      ))}
      {items.length === 0 && query.trim() && !showLiked && <p>{t("miniplayerUi.noMatch")}</p>}
    </>
  );
}
