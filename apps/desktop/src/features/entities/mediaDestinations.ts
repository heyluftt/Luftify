import type { EntitySummary, MediaItem } from "@luft/protocol-types";

export type MediaDestination = {
  path: string;
  label: string;
  summary?: EntitySummary;
};

export function albumDestination(item: Pick<MediaItem, "title" | "albumName" | "albumUri">): MediaDestination | undefined {
  const albumUri = item.albumUri?.trim();
  const albumName = item.albumName?.trim();

  if (albumUri && isAlbumUri(albumUri)) {
    return {
      path: `/album/${encodeURIComponent(albumUri)}`,
      label: albumName || item.title,
      summary: {
        uri: albumUri,
        name: albumName || item.title,
        subtitle: "Album",
      },
    };
  }

  if (albumName) {
    const params = new URLSearchParams({
      q: albumName,
      type: "albums",
    });
    return {
      path: `/search?${params.toString()}`,
      label: albumName,
    };
  }

  return undefined;
}

export function contextDestination(contextUri: string | undefined): MediaDestination | undefined {
  const uri = contextUri?.trim();
  if (!uri) return undefined;

  if (uri.startsWith("spotify:playlist:") || uri.startsWith("mock:playlist:")) {
    return {
      path: `/playlist/${encodeURIComponent(uri)}`,
      label: "Aktuelle Playlist",
      summary: {
        uri,
        name: "Playlist",
        subtitle: "Playlist",
      },
    };
  }

  if (isAlbumUri(uri)) {
    return {
      path: `/album/${encodeURIComponent(uri)}`,
      label: "Aktuelles Album",
      summary: {
        uri,
        name: "Album",
        subtitle: "Album",
      },
    };
  }

  if (isArtistUri(uri)) {
    return {
      path: `/artist/${encodeURIComponent(uri)}`,
      label: "Aktuelles Künstlerprofil",
      summary: {
        uri,
        name: "Künstler",
        subtitle: "Künstler",
      },
    };
  }

  return undefined;
}

function isAlbumUri(uri: string): boolean {
  return uri.startsWith("spotify:album:") || uri.startsWith("mock:album:");
}

function isArtistUri(uri: string): boolean {
  return uri.startsWith("spotify:artist:") || uri.startsWith("mock:artist:");
}
