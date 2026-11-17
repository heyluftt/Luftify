import { t } from "../../i18n";
import type { MediaItem, Page } from "@luft/protocol-types";
import { LoaderCircle, Play, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { matchesEveryWord } from "../textMatch";
import { SettingsSelect } from "../settings/SettingsSelect";
import { TrackList } from "../../components/TrackList";
import { LibraryLoadMore } from "./LibraryLoadMore";
import { LibraryPlaceholder, LibraryStatus } from "./LibraryStatus";
import { formatFilteredTrackCount, formatTrackCount } from "./libraryPresentation";
import type { LibraryPhase } from "./libraryState";
import {
  DEFAULT_PLAYLIST_SORT,
  sortPlaylistTracks,
  type PlaylistSort,
  type PlaylistSortField,
} from "./playlistSorting";

interface SavedTracksSectionProps {
  data: Page<MediaItem> | undefined;
  tracks: MediaItem[];
  phase: LibraryPhase;
  hasNextPage: boolean;
  pending: boolean;
  compactHeading?: boolean;
  onLoadMore: () => void;
  /** Sorting or filtering asks for every page. */
  onNeedAll?: () => void;
  loadingAll?: boolean;
  onPlay: (uri: string, index: number) => void;
  onPlayAll?: () => void;
  onQueue: (uri: string) => void;
  onSavedChange: (uri: string, saved: boolean) => void;
}

export function SavedTracksSection({
  data,
  tracks,
  phase,
  hasNextPage,
  pending,
  compactHeading = false,
  onLoadMore,
  onNeedAll,
  loadingAll = false,
  onPlay,
  onPlayAll,
  onQueue,
  onSavedChange,
}: SavedTracksSectionProps) {
  const [sort, setSort] = useState<PlaylistSort>(DEFAULT_PLAYLIST_SORT);
  const [query, setQuery] = useState("");
  const filtering = query.trim().length > 0;
  const visibleTracks = useMemo(
    () => sortPlaylistTracks(
      filtering
        ? tracks.filter((track) => matchesEveryWord(
          query,
          track.title,
          track.albumName,
          ...track.creators.map((creator) => creator.name),
        ))
        : tracks,
      sort,
    ),
    [filtering, query, sort, tracks],
  );
  const count = data ? (data.total ?? tracks.length) : undefined;
  const needsAll = filtering || sort.field !== DEFAULT_PLAYLIST_SORT.field
    || sort.direction !== DEFAULT_PLAYLIST_SORT.direction;

  useEffect(() => {
    if (needsAll && hasNextPage) onNeedAll?.();
  }, [hasNextPage, needsAll, onNeedAll]);

  const filterControl = onNeedAll && tracks.length > 0 && (
    <label className="library-filter">
      <Search size={14} aria-hidden="true" />
      <span className="sr-only">{t("libraryUi.filterTracks")}</span>
      <input
        value={query}
        maxLength={80}
        autoComplete="off"
        spellCheck={false}
        placeholder={t("library.filter")}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.stopPropagation();
            setQuery("");
          }
        }}
      />
      {query && (
        <button
          type="button"
          className="library-filter-clear"
          aria-label={t("libraryUi.clearFilter")}
          onClick={() => setQuery("")}
        >
          <X size={13} />
        </button>
      )}
    </label>
  );
  const loadingAllStatus = loadingAll && count !== undefined && (
    <span className="library-status refreshing-cache" role="status">
      <LoaderCircle size={13} />
      {t("libraryUi.loadingAll", { loaded: tracks.length, total: count })}
    </span>
  );
  const sortControl = tracks.length > 0 && (
    <div className="library-sort">
      <SettingsSelect
        inline
        label={t("libraryUi.sortTracks")}
        value={sort.field === "playlistOrder" ? "playlistOrder" : `${sort.field}:${sort.direction}`}
        onChange={(next) => setSort(parseLikedSort(next))}
      >
        <option value="addedAt:desc">{t("libraryUi.recentAdded")}</option>
        <option value="title:asc">{t("libraryUi.titleAsc")}</option>
        <option value="artist:asc">{t("libraryUi.artistAsc")}</option>
        <option value="playlistOrder">{t("libraryUi.order")}</option>
      </SettingsSelect>
    </div>
  );

  return (
    <section className="section-block library-section library-tracks-section">
      {compactHeading ? (
        (count !== undefined || data) ? (
          <div className="library-section-toolbar">
            {loadingAllStatus}
            {filterControl}
            {sortControl}
            {count !== undefined && (
              <span className="count-label">{filtering ? formatFilteredTrackCount(visibleTracks.length, count) : formatTrackCount(count)}</span>
            )}
            {data && <LibraryStatus phase={phase} />}
          </div>
        ) : null
      ) : (
        <div className="section-title library-section-header">
          <div className="library-section-heading">
            <h2>{t("libraryUi.savedTracks")}</h2>
          </div>
          <div className="library-section-side">
            {sortControl}
            {count !== undefined && (
              <span className="count-label">{filtering ? formatFilteredTrackCount(visibleTracks.length, count) : formatTrackCount(count)}</span>
            )}
            {onPlayAll && tracks.length > 0 && (
              <button
                type="button"
                className="secondary-button library-play-all"
                onClick={onPlayAll}
              >
                <Play size={14} fill="currentColor" />
                {t("library.playAll")}
              </button>
            )}
            {data && <LibraryStatus phase={phase} />}
          </div>
        </div>
      )}

      {data ? (
        tracks.length === 0 ? (
          <div className="library-empty">
            <p>{t("libraryUi.emptySaved")}</p>
          </div>
        ) : filtering && visibleTracks.length === 0 && !loadingAll ? (
          <div className="library-empty">
            <p>{t("libraryUi.noTrackMatch", { query: query.trim() })}</p>
            <button type="button" className="text-button" onClick={() => setQuery("")}>
              {t("libraryUi.clearFilter")}
            </button>
          </div>
        ) : (
          <>
            <TrackList
              tracks={visibleTracks}
              saved
              onPlay={onPlay}
              onQueue={onQueue}
              onSavedChange={onSavedChange}
              empty={t("libraryUi.emptySavedAvailable")}
            />
            {hasNextPage && !loadingAll && (
              <LibraryLoadMore pending={pending} onClick={onLoadMore} />
            )}
          </>
        )
      ) : (
        <LibraryPlaceholder phase={phase} />
      )}
    </section>
  );
}

function parseLikedSort(value: string): PlaylistSort {
  if (value === "playlistOrder") {
    return { field: "playlistOrder", direction: "asc" };
  }
  const [field, direction] = value.split(":");
  if (
    (field === "addedAt" || field === "title" || field === "artist")
    && (direction === "asc" || direction === "desc")
  ) {
    return { field: field as PlaylistSortField, direction };
  }
  return DEFAULT_PLAYLIST_SORT;
}
