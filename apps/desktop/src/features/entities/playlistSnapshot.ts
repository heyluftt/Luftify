import type { MediaItem, PlaylistDetails } from "@luft/protocol-types";

export function canonicalPlaylistUri(uri: string): string {
  const normalized = uri.trim();
  if (normalized.startsWith("spotify:playlist:")) {
    const id = normalized.slice("spotify:playlist:".length);
    return id && !id.includes(":") ? `spotify:playlist:${id}` : normalized;
  }
  if (!normalized.startsWith("spotify:user:")) return normalized;
  const marker = ":playlist:";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return normalized;
  const id = normalized.slice(markerIndex + marker.length);
  return id && !id.includes(":") ? `spotify:playlist:${id}` : normalized;
}

export function preferPlaylistSnapshot(
  live: PlaylistDetails | undefined,
  cached: PlaylistDetails | null | undefined,
): PlaylistDetails | undefined {
  if (!live) return cached ?? undefined;
  if (!cached) {
    return { ...live, tracks: uniquePlaylistTracks(live.tracks) };
  }
  const merged = {
    ...live,
    ...(live.owner === undefined && cached.owner ? { owner: cached.owner } : {}),
    ...(live.collaborative === undefined && cached.collaborative !== undefined ? { collaborative: cached.collaborative } : {}),
    tracks: uniquePlaylistTracks(mergePlaylistDates(live.tracks, cached.tracks)),
  };
  if (shouldKeepCachedPlaylist(cached, merged)) {
    return {
      ...cached,
      ...(merged.owner ? { owner: merged.owner } : {}),
      ...(merged.collaborative !== undefined ? { collaborative: merged.collaborative } : {}),
      tracks: uniquePlaylistTracks(mergePlaylistDates(cached.tracks, merged.tracks)),
      total: Math.max(
        cached.total ?? cached.tracks.length,
        live.total ?? live.tracks.length,
      ),
      hasMore: live.hasMore || cached.hasMore,
    };
  }
  return merged;
}

function uniquePlaylistTracks(tracks: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    const id = track.playlistEntryId?.trim();
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function shouldKeepCachedPlaylist(
  cached: PlaylistDetails,
  incoming: PlaylistDetails,
): boolean {
  if (cached.hasMore) return false;
  const incomingTotal = incoming.total ?? incoming.tracks.length;
  const incomingComplete =
    !incoming.hasMore && incoming.tracks.length >= incomingTotal;
  if (incomingComplete && incoming.tracks.length >= cached.tracks.length) {
    return false;
  }
  return incoming.tracks.length <= cached.tracks.length + 8;
}

export function mergePlaylistDates(
  incoming: MediaItem[],
  cached: MediaItem[],
): MediaItem[] {
  const byEntry = new Map<string, MediaItem>();
  const byUri = new Map<string, MediaItem[]>();
  for (const track of cached) {
    if (track.playlistEntryId) {
      byEntry.set(track.playlistEntryId, track);
    }
    const occurrences = byUri.get(track.uri) ?? [];
    occurrences.push(track);
    byUri.set(track.uri, occurrences);
  }
  return incoming.map((track) => {
    const occurrences = byUri.get(track.uri);
    // Known entry IDs must not borrow another occurrence's author after removal.
    const cachedTrack = track.playlistEntryId
      ? byEntry.get(track.playlistEntryId) ?? occurrences?.find(entry => !entry.playlistEntryId)
      : occurrences?.shift();
    if (cachedTrack && occurrences) {
      const index = occurrences.indexOf(cachedTrack);
      if (index >= 0) occurrences.splice(index, 1);
    }
    if (!track.addedBy && cachedTrack?.addedBy) track = { ...track, addedBy: cachedTrack.addedBy };
    if (!cachedTrack || isPlaylistTrackPlaceholder(cachedTrack)) {
      return track.addedAt?.trim()
        ? track
        : cachedTrack?.addedAt?.trim()
          ? { ...track, addedAt: cachedTrack.addedAt }
          : track;
    }
    const metadata = isPlaylistTrackPlaceholder(track) || !track.coverUri
      ? {
          ...track,
          ...(isPlaylistTrackPlaceholder(track)
            ? {
                title: cachedTrack.title,
                creators: cachedTrack.creators,
                ...(cachedTrack.albumName !== undefined
                  ? { albumName: cachedTrack.albumName }
                  : {}),
                ...(cachedTrack.albumUri !== undefined
                  ? { albumUri: cachedTrack.albumUri }
                  : {}),
                ...(cachedTrack.durationMs !== undefined
                  ? { durationMs: cachedTrack.durationMs }
                  : {}),
                ...(cachedTrack.explicit !== undefined
                  ? { explicit: cachedTrack.explicit }
                  : {}),
              }
            : {}),
          ...(cachedTrack.coverUri !== undefined
            ? { coverUri: cachedTrack.coverUri }
            : {}),
        }
      : track;
    if (metadata.addedAt?.trim()) return metadata;
    const addedAt = cachedTrack.addedAt?.trim();
    return addedAt ? { ...metadata, addedAt } : metadata;
  });
}

export function readyPlaylistTracks(tracks: MediaItem[]): MediaItem[] {
  return tracks.filter((track) => !isPlaylistTrackPlaceholder(track));
}

export function isPlaylistTrackPlaceholder(track: MediaItem): boolean {
  const title = track.title.trim();
  const uriTail = track.uri.split(":").at(-1) ?? "";
  return title.length === 0
    || title.startsWith("Titel wird geladen")
    || title === "Unbekannter Titel"
    || title === track.uri
    || title === uriTail
    || looksLikeSpotifyId(title);
}

// Base62 IDs mix digits and both cases; a 22-letter single-word title
// ("Weltuntergangsstimmung") must still count as a real track.
function looksLikeSpotifyId(value: string): boolean {
  return value.length === 22
    && /^[a-zA-Z0-9]+$/.test(value)
    && /\d/.test(value)
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value);
}

export function playlistPlaceholderCount(details: PlaylistDetails): number {
  return details.tracks.filter(isPlaylistTrackPlaceholder).length;
}
