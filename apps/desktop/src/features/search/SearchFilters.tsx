import {
  Disc3,
  LayoutGrid,
  LibraryBig,
  ListMusic,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { t, type MessageKey } from "../../i18n";
import type {
  SearchCategory,
  SearchCounts,
} from "./searchTypes";

export type { SearchCategory } from "./searchTypes";

type SearchFiltersProps = {
  active: SearchCategory;
  counts: SearchCounts;
  unavailable?: ReadonlySet<SearchCategory>;
  onChange: (category: SearchCategory) => void;
};

type FilterDefinition = {
  id: SearchCategory;
  label: MessageKey;
  icon: LucideIcon;
};

const FILTERS: FilterDefinition[] = [
  { id: "all", label: "search.filter.all", icon: LayoutGrid },
  { id: "tracks", label: "search.filter.tracks", icon: ListMusic },
  { id: "artists", label: "search.filter.artists", icon: UserRound },
  { id: "albums", label: "search.filter.albums", icon: Disc3 },
  { id: "playlists", label: "search.filter.playlists", icon: LibraryBig },
];

export function SearchFilters({
  active,
  counts,
  unavailable = new Set(),
  onChange,
}: SearchFiltersProps) {
  return (
    <div
      className="search-filter-bar"
      role="tablist"
      aria-label={t("search.filterAria")}
    >
      {FILTERS.map(({ id, label: labelKey, icon: Icon }) => {
        const label = t(labelKey);
        return (
          <button
            type="button"
            key={id}
            className={active === id ? "active" : undefined}
            role="tab"
            aria-selected={active === id}
            title={
              unavailable.has(id)
                ? t("search.filterUnavailable", { kind: label })
                : undefined
            }
            disabled={
              id !== "all" &&
              (counts[id] === 0 || unavailable.has(id))
            }
            onClick={() => onChange(id)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
            <small>{counts[id]}</small>
          </button>
        );
      })}
    </div>
  );
}
