import type { EntitySummary, MediaItem } from "@luft/protocol-types";
import { t } from "../../i18n";
import { formatTrackCount } from "../library/libraryPresentation";
import type { SearchEntityCategory } from "../search/searchEntityKind";
import { matchKey } from "../textMatch";
import type { PaletteGroup, PaletteItem } from "./paletteTypes";

/** Palette rows for music: songs, albums, artists, playlists and liked songs. */
const KIND_KEY = {
  artists: "search.kind.artist",
  albums: "search.kind.album",
  playlists: "search.kind.playlist",
} as const;

export function entityItem(group: PaletteGroup, category: SearchEntityCategory, entry: EntitySummary): PaletteItem {
  const count = entry.library?.trackCount;
  const kind = t(KIND_KEY[category]);
  const detail = count !== undefined
    ? formatTrackCount(count)
    : entry.subtitle && matchKey(entry.subtitle) !== matchKey(kind) ? entry.subtitle : undefined;
  return {
    id: `${category}:${entry.uri}`,
    group,
    label: entry.name,
    subtitle: [kind, detail].filter(Boolean).join(" · "),
    keywords: [],
    icon: category === "artists" ? "artist" : category === "albums" ? "album" : "playlist",
    ...(entry.coverUri ? { cover: entry.coverUri } : {}),
    action: { kind: "media", media: { kind: "entity", category, entry } },
  };
}

export function trackItem(group: PaletteGroup, track: MediaItem, context?: { uri: string; tracks: MediaItem[] }): PaletteItem {
  const artists = track.creators.map((creator) => creator.name).join(", ");
  return {
    id: `tracks:${track.uri}`,
    group,
    label: track.title,
    subtitle: [t("search.kind.track"), artists].filter(Boolean).join(" · "),
    keywords: [],
    icon: "track",
    ...(track.coverUri ? { cover: track.coverUri } : {}),
    action: { kind: "media", media: { kind: "track", track, ...(context ? { context } : {}) } },
  };
}

export function likedItem(count: number | undefined): PaletteItem {
  return {
    id: "liked",
    group: "library",
    label: t("library.liked"),
    subtitle: [t("search.kind.playlist"), count !== undefined ? formatTrackCount(count) : ""].filter(Boolean).join(" · "),
    keywords: [],
    icon: "liked",
    action: { kind: "media", media: { kind: "liked" } },
  };
}
