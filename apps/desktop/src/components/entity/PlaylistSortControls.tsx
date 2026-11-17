import { t } from "../../i18n";
import {
  ArrowDown,
  ArrowUp,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import type {
  PlaylistSort,
  PlaylistSortField,
} from "../../features/library/playlistSorting";
import { sortDirectionLabel } from "../../features/entities/playlistSortPresentation";
import { SettingsSelect } from "../../features/settings/SettingsSelect";

interface PlaylistSortControlsProps {
  sort: PlaylistSort;
  total: number;
  visibleTotal: number;
  searchQuery: string;
  onSelect: (field: PlaylistSortField) => void;
  onToggleDirection: () => void;
  onSearchQueryChange: (query: string) => void;
}

export function PlaylistSortControls({
  sort,
  total,
  visibleTotal,
  searchQuery,
  onSelect,
  onToggleDirection,
  onSearchQueryChange,
}: PlaylistSortControlsProps) {
  return (
    <div className="playlist-sort-controls">
      <label className="playlist-track-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={searchQuery}
          placeholder={t("libraryUi.searchPlaylist")}
          aria-label={t("libraryUi.searchPlaylistLabel")}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && searchQuery) {
              event.preventDefault();
              onSearchQueryChange("");
            }
          }}
        />

        {searchQuery && (
          <button
            type="button"
            className="playlist-track-search-clear"
            aria-label={t("libraryUi.clearSearch")}
            onClick={() => onSearchQueryChange("")}
          >
            <X size={14} />
          </button>
        )}
      </label>

      <div className="playlist-sort-select">
        <ListFilter size={15} aria-hidden="true" />
        <span>{t("libraryUi.sort")}</span>

        <SettingsSelect
          inline
          label={t("libraryUi.sortPlaylist")}
          value={sort.field}
          onChange={(next) => onSelect(next as PlaylistSortField)}
        >
          <option value="addedAt">{t("libraryUi.addedAt")}</option>
          <option value="playlistOrder">{t("libraryUi.playlistOrder")}</option>
          <option value="title">{t("libraryUi.title")}</option>
          <option value="artist">{t("libraryUi.artist")}</option>
          <option value="album">{t("libraryUi.album")}</option>
          <option value="duration">{t("libraryUi.duration")}</option>
        </SettingsSelect>
      </div>

      <button
        type="button"
        className="playlist-sort-direction"
        onClick={onToggleDirection}
      >
        {sort.direction === "desc" ? (
          <ArrowDown size={15} />
        ) : (
          <ArrowUp size={15} />
        )}

        {sortDirectionLabel(sort)}
      </button>

      <span className="count-label">
        {searchQuery
          ? t(total === 1 ? "libraryUi.filteredTracksOne" : "libraryUi.filteredTracks", { visible: visibleTotal, count: total })
          : t(total === 1 ? "libraryUi.trackCountOne" : "libraryUi.trackCount", { count: total })}
      </span>
    </div>
  );
}
