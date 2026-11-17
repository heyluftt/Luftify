import { useQuery } from "@tanstack/react-query";
import { t } from "../../i18n";
import { linkQuery } from "../links/linkLookup";
import type { SpotifyLink, SpotifyLinkKind } from "../links/spotifyLink";
import type { SearchEntityCategory } from "../search/searchEntityKind";
import { entityItem, trackItem } from "./paletteMediaItems";
import type { PaletteItem } from "./paletteTypes";

const CATEGORY: Record<Exclude<SpotifyLinkKind, "track">, SearchEntityCategory> = {
  album: "albums",
  artist: "artists",
  playlist: "playlists",
};
const KIND_KEY = {
  track: "search.kind.track",
  album: "search.kind.album",
  artist: "search.kind.artist",
  playlist: "search.kind.playlist",
} as const;

/**
 * A pasted Spotify link as one palette row: the song, album, playlist or
 * artist it points to, like a search hit. Until it is looked up, or when it
 * cannot be, the row still plays or opens the link.
 */
export function usePaletteLink(link: SpotifyLink | undefined, open: boolean): PaletteItem[] {
  const resolved = useQuery({ ...linkQuery(link), enabled: open && Boolean(link) });
  if (!link) return [];
  const found = resolved.data;
  const item = found?.kind === "track" ? trackItem("link", found.track)
    : found?.kind === "entity" && link.kind !== "track" ? entityItem("link", CATEGORY[link.kind], found.entry)
    : linkItem(link, resolved.isFetching);
  return [{ ...item, group: "link" }];
}

/** The same row without details; the id matches the resolved one, so the selection stays. */
function linkItem(link: SpotifyLink, loading: boolean): PaletteItem {
  const kind = t(KIND_KEY[link.kind]);
  return {
    id: link.kind === "track" ? `tracks:${link.uri}` : `${CATEGORY[link.kind]}:${link.uri}`,
    group: "link",
    label: link.kind === "track" ? t("command.link.play") : t("command.link.open", { kind }),
    subtitle: loading ? t("command.link.loading") : kind,
    keywords: [],
    icon: link.kind === "track" ? "track" : link.kind === "playlist" ? "playlist" : link.kind,
    action: { kind: "link", link },
  };
}
