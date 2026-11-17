import { Folder, LayoutGrid, List, Search, X } from "lucide-react";
import { t, type MessageKey } from "../../i18n";
import { SettingsSelect } from "../settings/SettingsSelect";
import type { LibraryPlaylistSort, PlaylistOwnerGroup } from "./libraryPresentation";
import type { LibraryView } from "./libraryViewPrefs";

export type OwnerFilter = "all" | PlaylistOwnerGroup;

const OWNER_LABELS: Record<OwnerFilter, MessageKey> = {
  all: "libraryUi.ownerAll",
  mine: "libraryUi.ownerMine",
  followed: "libraryUi.ownerFollowed",
  spotify: "libraryUi.ownerSpotify",
};

const SORT_LABELS: Record<LibraryPlaylistSort, MessageKey> = {
  smart: "libraryUi.smart",
  recent: "libraryUi.recent",
  "most-played": "libraryUi.frequent",
  added: "libraryUi.recentAdded",
  library: "libraryUi.spotifyOrder",
  "name-asc": "libraryUi.nameAsc",
  "name-desc": "libraryUi.nameDesc",
  size: "libraryUi.size",
};

/** Owner and folder chips; each shows only when it would narrow the list. */
export function LibraryChips({
  owners,
  owner,
  onOwner,
  folders,
  folder,
  onFolder,
}: {
  owners: Partial<Record<OwnerFilter, number>>;
  owner: OwnerFilter;
  onOwner: (owner: OwnerFilter) => void;
  folders: readonly string[];
  folder: string | undefined;
  onFolder: (folder: string | undefined) => void;
}) {
  const ownerChips = (Object.keys(OWNER_LABELS) as OwnerFilter[])
    .filter((key) => key === "all" || (owners[key] ?? 0) > 0);
  if (ownerChips.length <= 2 && folders.length === 0) return null;

  return (
    <div className="library-chips" role="group" aria-label={t("libraryUi.ownerFilter")}>
      {ownerChips.length > 2 && ownerChips.map((key) => (
        <button
          type="button"
          key={key}
          className={owner === key && !folder ? "active" : undefined}
          aria-pressed={owner === key && !folder}
          onClick={() => {
            onOwner(key);
            onFolder(undefined);
          }}
        >
          {t(OWNER_LABELS[key])}
          <small>{owners[key] ?? 0}</small>
        </button>
      ))}
      {folders.map((name) => (
        <button
          type="button"
          key={name}
          className={folder === name ? "active is-folder" : "is-folder"}
          aria-pressed={folder === name}
          onClick={() => onFolder(folder === name ? undefined : name)}
        >
          <Folder size={13} aria-hidden="true" />
          {name}
        </button>
      ))}
    </div>
  );
}

export function LibraryControls({
  query,
  onQuery,
  sort,
  onSort,
  view,
  onView,
}: {
  query: string;
  onQuery: (query: string) => void;
  sort: LibraryPlaylistSort;
  onSort: (sort: LibraryPlaylistSort) => void;
  view: LibraryView;
  onView: (view: LibraryView) => void;
}) {
  return (
    <>
      <label className="library-filter">
        <Search size={14} aria-hidden="true" />
        <span className="sr-only">{t("libraryUi.filterPlaylists")}</span>
        <input
          value={query}
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("library.filter")}
          onChange={(event) => onQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              onQuery("");
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="library-filter-clear"
            aria-label={t("libraryUi.clearFilter")}
            onClick={() => onQuery("")}
          >
            <X size={13} />
          </button>
        )}
      </label>
      <div className="library-sort">
        <SettingsSelect
          inline
          label={t("libraryUi.sortPlaylists")}
          value={sort}
          onChange={(next) => onSort(next as LibraryPlaylistSort)}
        >
          {(Object.keys(SORT_LABELS) as LibraryPlaylistSort[]).map((key) => (
            <option key={key} value={key}>{t(SORT_LABELS[key])}</option>
          ))}
        </SettingsSelect>
      </div>
      <div className="library-view-toggle" role="group" aria-label={t("libraryUi.view")}>
        <button
          type="button"
          aria-pressed={view === "grid"}
          aria-label={t("libraryUi.viewGrid")}
          title={t("libraryUi.viewGrid")}
          onClick={() => onView("grid")}
        >
          <LayoutGrid size={15} />
        </button>
        <button
          type="button"
          aria-pressed={view === "list"}
          aria-label={t("libraryUi.viewList")}
          title={t("libraryUi.viewList")}
          onClick={() => onView("list")}
        >
          <List size={15} />
        </button>
      </div>
    </>
  );
}
