import { t } from "../../i18n";
import type { PlaylistSort } from "../library/playlistSorting";

export function sortDirectionLabel(sort: PlaylistSort): string {
  if (sort.field === "addedAt") {
    return sort.direction === "desc" ? t("libraryUi.newest") : t("libraryUi.oldest");
  }

  if (sort.field === "playlistOrder") {
    return sort.direction === "asc" ? t("libraryUi.original") : t("libraryUi.reversed");
  }

  if (sort.field === "duration") {
    return sort.direction === "desc" ? t("libraryUi.longest") : t("libraryUi.shortest");
  }

  return sort.direction === "desc" ? "Z–A" : "A–Z";
}
