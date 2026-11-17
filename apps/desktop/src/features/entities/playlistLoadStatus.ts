import { t } from "../../i18n";
import type { PlaylistDetails } from "@luft/protocol-types";
import { playlistPlaceholderCount } from "./playlistSnapshot";

export type PlaylistLoadKind = "idle" | "loading" | "filling" | "refreshing";

export function playlistLoadKind(input: {
  fetching: boolean;
  showingCached: boolean;
  details: PlaylistDetails | undefined;
}): PlaylistLoadKind {
  if (!input.fetching) return "idle";
  const tracks = input.details?.tracks.length ?? 0;
  if (tracks === 0) return "loading";
  if (input.showingCached) return "refreshing";
  const total = input.details?.total ?? tracks;
  const incomplete =
    input.details?.hasMore === true
    || tracks < total
    || (input.details ? playlistPlaceholderCount(input.details) : 0) > 0;
  return incomplete ? "filling" : "refreshing";
}

export function playlistLoadLabel(kind: PlaylistLoadKind): string | undefined {
  switch (kind) {
    case "loading":
      return t("playlist.loading");
    case "filling":
      return t("playlist.filling");
    case "refreshing":
      return t("playlist.refreshing");
    case "idle":
      return undefined;
  }
}
