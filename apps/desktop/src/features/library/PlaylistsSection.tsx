import { t } from "../../i18n";
import type { EntitySummary, Page } from "@luft/protocol-types";
import { useEffect, useMemo, useState } from "react";
import type { PlaylistUsage } from "../../types/tauri";
import { matchesEveryWord } from "../textMatch";
import { LibraryLoadMore } from "./LibraryLoadMore";
import {
  LikedSongsCard,
  LikedSongsRow,
  PlaylistCard,
  PlaylistRow,
} from "./LibraryPlaylistItems";
import { LibraryPlaceholder, LibraryStatus } from "./LibraryStatus";
import { LibraryChips, LibraryControls, type OwnerFilter } from "./LibraryToolbar";
import {
  filterPlaylists,
  formatPlaylistCount,
  playlistOwnerGroup,
  playlistUsageDescription,
  sortPlaylists,
  type LibraryPlaylistSort,
} from "./libraryPresentation";
import type { LibraryPhase } from "./libraryState";
import {
  readFolderFilter,
  readLibraryView,
  readOwnerFilter,
  readPlaylistSort,
  saveFolderFilter,
  saveLibraryView,
  saveOwnerFilter,
  savePlaylistSort,
  type LibraryView,
} from "./libraryViewPrefs";

interface PlaylistsSectionProps {
  data: Page<EntitySummary> | undefined;
  usage?: PlaylistUsage[];
  usagePending?: boolean;
  phase: LibraryPhase;
  hasNextPage: boolean;
  pending: boolean;
  onLoadMore: () => void;
  onOpenPlaylist: (playlist: EntitySummary) => void;
  onPlayPlaylist: (playlist: EntitySummary) => void;
  /** Pins Liked Songs as the first entry when given. */
  liked?: {
    count: number | undefined;
    onOpen: () => void;
    onPlay: () => void;
  } | undefined;
}

export function PlaylistsSection({
  data,
  usage = [],
  usagePending = false,
  phase,
  hasNextPage,
  pending,
  onLoadMore,
  onOpenPlaylist,
  onPlayPlaylist,
  liked,
}: PlaylistsSectionProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibraryPlaylistSort>(readPlaylistSort);
  const [view, setView] = useState<LibraryView>(readLibraryView);
  const [owner, setOwner] = useState<OwnerFilter>(readOwnerFilter);
  const [folder, setFolder] = useState<string | undefined>(readFolderFilter);
  const items = useMemo(() => data?.items ?? [], [data]);

  const owners = useMemo(() => {
    const counts: Partial<Record<OwnerFilter, number>> = { all: items.length };
    for (const item of items) {
      const group = playlistOwnerGroup(item);
      counts[group] = (counts[group] ?? 0) + 1;
    }
    return counts;
  }, [items]);
  const folders = useMemo(
    () => [...new Set(items.flatMap((item) => topFolder(item) ?? []))]
      .sort((left, right) => left.localeCompare(right)),
    [items],
  );
  const visible = useMemo(() => {
    const narrowed = items.filter((item) =>
      (folder ? topFolder(item) === folder : owner === "all" || playlistOwnerGroup(item) === owner));
    return sortPlaylists(filterPlaylists(narrowed, query), sort, usage);
  }, [folder, items, owner, query, sort, usage]);
  const usageCopy = useMemo(() => new Map(
    items.flatMap((item) => {
      const description = playlistUsageDescription(item.uri, usage);
      return description ? [[item.uri, description] as const] : [];
    }),
  ), [items, usage]);

  useEffect(() => savePlaylistSort(sort), [sort]);
  useEffect(() => saveLibraryView(view), [view]);
  useEffect(() => saveOwnerFilter(owner), [owner]);
  useEffect(() => saveFolderFilter(folder), [folder]);
  // A remembered folder that no longer exists would hide everything; only
  // judge it once the library has loaded.
  useEffect(() => {
    if (items.length > 0 && folder && !folders.includes(folder)) setFolder(undefined);
  }, [folder, folders, items.length]);
  useEffect(() => {
    if (items.length > 0 && owner !== "all" && !owners[owner]) setOwner("all");
  }, [items.length, owner, owners]);

  const narrowing = query.trim().length > 0 || owner !== "all" || folder !== undefined;
  const total = data?.total ?? items.length;
  const sortHint = playlistSortHint(sort, usage.length, usagePending);
  const showLiked = Boolean(liked)
    && !folder
    && (owner === "all" || owner === "mine")
    && matchesEveryWord(query, t("library.liked"));
  const showFolder = folders.length > 0;

  return (
    <section className="section-block library-section library-playlists-section">
      <div className="section-title library-section-header">
        <div className="library-section-heading">
          <h2>{t("library.playlists")}</h2>
          <p>{sortHint}</p>
        </div>
        <div className="library-section-side">
          {data && items.length > 0 && (
            <LibraryControls
              query={query}
              onQuery={setQuery}
              sort={sort}
              onSort={setSort}
              view={view}
              onView={setView}
            />
          )}
          {data && (
            <span className="count-label">
              {formatPlaylistCount(visible.length, total, narrowing)}
            </span>
          )}
          {data && <LibraryStatus phase={phase} />}
        </div>
      </div>

      {data && items.length > 0 && (
        <LibraryChips
          owners={owners}
          owner={owner}
          onOwner={setOwner}
          folders={folders}
          folder={folder}
          onFolder={setFolder}
        />
      )}

      {data ? (
        items.length === 0 && !liked ? (
          <div className="library-empty">
            <p>{t("libraryUi.emptyPlaylists")}</p>
          </div>
        ) : visible.length === 0 && !showLiked ? (
          <div className="library-empty">
            <p>{query.trim() ? t("libraryUi.noMatch", { query: query.trim() }) : t("libraryUi.emptyPlaylists")}</p>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setQuery("");
                setOwner("all");
                setFolder(undefined);
              }}
            >
              {t("libraryUi.clearFilter")}
            </button>
          </div>
        ) : (
          <>
            {view === "grid" ? (
              <div className="ds-grid library-playlist-grid">
                {showLiked && liked && <LikedSongsCard {...liked} />}
                {visible.map((item) => (
                  <PlaylistCard
                    key={item.uri}
                    item={item}
                    usage={usageCopy.get(item.uri)}
                    onOpen={() => onOpenPlaylist(item)}
                    onPlay={() => onPlayPlaylist(item)}
                  />
                ))}
              </div>
            ) : (
              <div className={showFolder ? "library-playlist-list has-folders" : "library-playlist-list"}>
                <div className="library-list-header" aria-hidden="true">
                  <span>{t("search.kind.playlist")}</span>
                  {showFolder && <span>{t("libraryUi.folder")}</span>}
                  <span>{t("libraryUi.recent")}</span>
                  <span>{t("libraryUi.added")}</span>
                </div>
                {showLiked && liked && <LikedSongsRow {...liked} showFolder={showFolder} />}
                {visible.map((item) => (
                  <PlaylistRow
                    key={item.uri}
                    item={item}
                    usage={usageCopy.get(item.uri)}
                    showFolder={showFolder}
                    onOpen={() => onOpenPlaylist(item)}
                    onPlay={() => onPlayPlaylist(item)}
                  />
                ))}
              </div>
            )}

            {hasNextPage && !narrowing && (
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

function topFolder(item: EntitySummary): string | undefined {
  return item.library?.folder?.split(" / ")[0];
}

function playlistSortHint(
  sort: LibraryPlaylistSort,
  usageCount: number,
  usagePending: boolean,
): string {
  switch (sort) {
    case "smart":
      if (usagePending) return t("libraryUi.habitsLoading");
      if (usageCount === 0) return t("libraryUi.habitsEmpty");
      return t("libraryUi.smartHint");
    case "recent": return t("libraryUi.recentHint");
    case "most-played": return t("libraryUi.frequentHint");
    case "added": return t("libraryUi.addedHint");
    case "library": return t("libraryUi.spotifyHint");
    case "name-asc": return t("libraryUi.ascHint");
    case "name-desc": return t("libraryUi.descHint");
    case "size": return t("libraryUi.sizeHint");
  }
}
