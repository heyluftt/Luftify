import type { MediaItem } from "@luft/protocol-types";
import {
  isPlayableAlbumUri,
  isPlayableArtistUri,
} from "../entities/entityPlayback";
import {
  buildLyricsRequest,
  lyricsQueryKey,
} from "../lyrics/useLyricsQuery";
import type { LyricsRequest } from "../../types/tauri";
import type { CoverSize } from "../../components/coverSizing";

export const PREFETCH_COVER_STALE_TIME = Number.POSITIVE_INFINITY;
export const PREFETCH_LYRICS_STALE_TIME = 30 * 60_000;
export const PREFETCH_CATALOG_STALE_TIME = 2 * 60_000;
export const PREFETCH_QUEUE_COVER_LIMIT = 24;
export const PREFETCH_QUEUE_LYRICS_LIMIT = 1;

export type PrefetchTarget =
  | { kind: "lyrics"; request: LyricsRequest; current: boolean }
  | { kind: "cover"; url: string; sizes: CoverSize[] }
  | { kind: "album"; uri: string }
  | { kind: "artist"; uri: string }
  | { kind: "playlist"; uri: string };

export function httpsCoverUrl(coverUri: string | undefined): string | undefined {
  const url = coverUri?.trim();
  return url?.startsWith("https://") ? url : undefined;
}

export function coverQueryKey(coverUri: string | undefined) {
  const url = httpsCoverUrl(coverUri);
  return url ? (["cover", url] as const) : undefined;
}

export function collectSnapshotCoverUrls(
  tracks: Array<Pick<MediaItem, "coverUri">> | undefined,
  limit = PREFETCH_QUEUE_COVER_LIMIT,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const track of tracks ?? []) {
    const url = httpsCoverUrl(track.coverUri);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= limit) break;
  }
  return urls;
}

export function collectPrefetchTargets(input: {
  current?: MediaItem | undefined;
  next?: MediaItem | undefined;
  upcoming?: Array<MediaItem | undefined> | undefined;
  durationMs?: number | undefined;
  contextUri?: string | undefined;
}): PrefetchTarget[] {
  const targets: PrefetchTarget[] = [];
  const seen = new Set<string>();
  const upcoming = (input.upcoming ?? []).filter(
    (item): item is MediaItem => Boolean(item),
  );
  const next = input.next ?? upcoming[0];

  const push = (target: PrefetchTarget) => {
    const key =
      target.kind === "lyrics"
        ? `lyrics:${target.request.trackUri}`
        : `${target.kind}:${target.kind === "cover" ? target.url : target.uri}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };

  const lyricItems = [input.current, next, ...upcoming.slice(0, PREFETCH_QUEUE_LYRICS_LIMIT)];
  const seenLyrics = new Set<MediaItem>();
  for (const item of lyricItems) {
    if (!item || seenLyrics.has(item)) continue;
    seenLyrics.add(item);
    const lyrics = buildLyricsRequest(
      item,
      item === input.current ? input.durationMs : undefined,
    );
    if (lyrics) {
      push({
        kind: "lyrics",
        request: lyrics,
        current: item === input.current,
      });
    }
  }

  // Only the sizes that will be shown: the player bar and the big views for
  // what plays now and next, the row thumbnail for the rest of the queue.
  const coverItems = [input.current, ...upcoming.slice(0, PREFETCH_QUEUE_COVER_LIMIT)];
  for (const item of coverItems) {
    if (!item) continue;
    const cover = httpsCoverUrl(item.coverUri);
    if (!cover) continue;
    const prominent = item === input.current || item === next;
    push({ kind: "cover", url: cover, sizes: prominent ? ["small", "feature"] : ["tiny"] });
  }

  const albumUri = input.current?.albumUri;
  if (isPlayableAlbumUri(albumUri)) {
    push({ kind: "album", uri: albumUri });
  }

  const artistUri = input.current?.creators.find((creator) =>
    isPlayableArtistUri(creator.uri),
  )?.uri;
  if (artistUri) {
    push({ kind: "artist", uri: artistUri });
  }

  const contextUri = input.contextUri?.trim();
  if (contextUri?.startsWith("spotify:playlist:")) {
    push({ kind: "playlist", uri: contextUri });
  }

  return targets;
}

export function lyricsPrefetchKey(request: LyricsRequest) {
  return lyricsQueryKey(request, request.trackUri);
}
