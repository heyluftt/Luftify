import type { EntitySummary } from "@luft/protocol-types";
import { MediaTile } from "../../components/ui/MediaTile";
import { t } from "../../i18n";
import { entitySubtitle, type SearchEntityCategory } from "./searchEntityKind";
import { SearchSectionHeading } from "./SearchSectionHeading";

/** Tiles in one overview row; the shelf scrolls sideways when it runs out of room. */
export const ENTITY_PREVIEW_COUNT = 6;

type SearchEntitySectionProps = {
  title: string;
  entries: EntitySummary[];
  category: SearchEntityCategory;
  onOpen: (entry: EntitySummary, category: SearchEntityCategory) => void;
  preview?: boolean;
  onShowAll?: (() => void) | undefined;
};

export function SearchEntitySection({
  title,
  entries,
  category,
  onOpen,
  preview = false,
  onShowAll,
}: SearchEntitySectionProps) {
  if (entries.length === 0) {
    return null;
  }

  const shown = preview ? entries.slice(0, ENTITY_PREVIEW_COUNT) : entries;

  return (
    <section
      className={`search-result-section search-entity-section search-entity-section-${category}`}
      aria-labelledby={`search-${category}-heading`}
    >
      <SearchSectionHeading
        id={`search-${category}-heading`}
        title={title}
        count={entries.length}
        onShowAll={onShowAll}
      />

      <div className={preview ? "ds-shelf search-entity-grid" : "ds-grid search-entity-grid"}>
        {shown.map((entry) => (
          <MediaTile
            key={entry.uri}
            round={category === "artists"}
            title={entry.name}
            subtitle={entitySubtitle(entry, category)}
            image={entry.coverUri}
            openLabel={t("search.open", { name: entry.name })}
            onOpen={() => onOpen(entry, category)}
          />
        ))}
      </div>
    </section>
  );
}
