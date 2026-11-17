import type { EntitySummary } from "@luft/protocol-types";
import { t } from "../../i18n";
import type { SearchCategory } from "./searchTypes";

export type SearchEntityCategory = Extract<
  SearchCategory,
  "artists" | "albums" | "playlists"
>;

export function searchKindLabel(category: SearchEntityCategory | "tracks"): string {
  switch (category) {
    case "tracks": return t("search.kind.track");
    case "artists": return t("search.kind.artist");
    case "albums": return t("search.kind.album");
    case "playlists": return t("search.kind.playlist");
  }
}

/** Artists only carry a generic (German) type label from the backend. */
export function entitySubtitle(entry: EntitySummary, category: SearchEntityCategory): string {
  return category === "artists"
    ? searchKindLabel(category)
    : entry.subtitle?.trim() || searchKindLabel(category);
}
