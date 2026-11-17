import type { EntitySummary, MediaItem } from "@luft/protocol-types";
import { desktopApi } from "../../services/desktopApi";
import type { SpotifyLink } from "./spotifyLink";

const FIRST = { offset: 0, limit: 1 };

/** What a Spotify link points to: a song with its details, or an album, playlist or artist summary. */
export type LinkTarget = { kind: "track"; track: MediaItem } | { kind: "entity"; entry: EntitySummary };

/** Looks the link up once; null when it cannot be read (offline, unavailable, desktop engine for songs). */
export async function lookupLink(link: SpotifyLink): Promise<LinkTarget | null> {
  if (link.kind === "track") {
    const track = await desktopApi.track(link.uri).catch(() => null);
    return track ? { kind: "track", track } : null;
  }
  const entry = await entitySummary(link).catch(() => null);
  return entry ? { kind: "entity", entry } : null;
}

async function entitySummary(link: SpotifyLink): Promise<EntitySummary | null> {
  switch (link.kind) {
    case "album": {
      const album = await desktopApi.album(link.uri, FIRST);
      return summary(link.uri, album.name, album.coverUri, album.artists.map((artist) => artist.name).join(", "));
    }
    case "playlist": {
      const playlist = await desktopApi.cachedPlaylist(link.uri, FIRST).catch(() => null)
        ?? await desktopApi.playlist(link.uri, FIRST);
      return summary(link.uri, playlist.name, playlist.coverUri ?? playlist.tracks[0]?.coverUri, playlist.ownerName);
    }
    case "artist": {
      const artist = await desktopApi.artist(link.uri);
      return summary(link.uri, artist.name, artist.imageUri);
    }
    default:
      return null;
  }
}

function summary(uri: string, name: string, coverUri?: string, subtitle?: string): EntitySummary | null {
  if (!name.trim()) return null;
  return { uri, name, ...(subtitle ? { subtitle } : {}), ...(coverUri ? { coverUri } : {}) };
}

/** One cache entry per link for the palette and chat cards; no link asks nothing. */
export const linkQuery = (link: SpotifyLink | undefined) => ({
  queryKey: ["spotify-link", link?.uri ?? ""] as const,
  queryFn: (): Promise<LinkTarget | null> => link ? lookupLink(link) : Promise.resolve(null),
  enabled: Boolean(link),
  staleTime: 10 * 60_000,
  retry: false,
});
