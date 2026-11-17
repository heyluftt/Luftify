import type { MediaItem } from "@luft/protocol-types";
import { desktopApi } from "../../services/desktopApi";
import type { ListenTogetherStatus, SharedQueueGroup, SharedTrack } from "./listenTogetherTypes";

/** Mirrors MAX_QUEUE_ITEMS and MAX_BATCH_TRACKS in luft-listen-together. */
export const ROOM_QUEUE_LIMIT = 200;
export const ROOM_BATCH_TRACKS = 50;
// Well below the relay's 64 KiB message limit, whatever the titles are.
const BATCH_BYTES = 40_000;

export function sharedTrack(item: MediaItem): SharedTrack | null {
  if (!item.playable || !/^spotify:track:[A-Za-z0-9]{22}$/.test(item.uri)) return null;
  return {
    provider: "spotify",
    uri: item.uri,
    title: item.title,
    artists: item.creators.map((artist) => artist.name),
    ...(item.coverUri ? { coverUri: item.coverUri } : {}),
    ...(item.durationMs ? { durationMs: item.durationMs } : {}),
  };
}

/** Split into as few messages as the relay accepts. */
export function batchTracks(tracks: SharedTrack[]): SharedTrack[][] {
  const batches: SharedTrack[][] = [];
  let batch: SharedTrack[] = [];
  let bytes = 0;
  for (const track of tracks) {
    const size = JSON.stringify(track).length + 1;
    if (batch.length && (batch.length >= ROOM_BATCH_TRACKS || bytes + size > BATCH_BYTES)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(track);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export interface RoomAddResult { added: number; skipped: number }

/**
 * Sends a selection as a few `addMany` edits, one after another, so every
 * member gets a handful of queue updates instead of one per song. With
 * `next`, batches go in reverse so the selection keeps its order up front.
 */
export async function addTracksToRoom(status: ListenTogetherStatus, items: MediaItem[], next: boolean, group?: SharedQueueGroup): Promise<RoomAddResult> {
  if (!status.roomId) throw new Error("listen.queueUnavailable");
  const tracks = items.map(sharedTrack).filter((track): track is SharedTrack => Boolean(track));
  const free = Math.max(0, ROOM_QUEUE_LIMIT - (status.queue?.items.length ?? 0));
  const taken = tracks.slice(0, free);
  if (!taken.length) throw new Error(tracks.length ? "listen.queueFull" : "listen.queueNothingPlayable");
  const batches = batchTracks(taken);
  for (const batch of next ? batches.reverse() : batches) {
    // One group across all batches, so the playlist stays one block.
    await desktopApi.listenTogetherQueueEdit(status.roomId, { type: "addMany", tracks: batch, next, ...(group ? { group } : {}) });
  }
  return { added: taken.length, skipped: items.length - taken.length };
}

/** A playlist's or album's songs, at most `limit`. Uses caches where the app has them. */
export async function collectionTracks(uri: string, limit = ROOM_QUEUE_LIMIT): Promise<MediaItem[]> {
  if (uri.startsWith("spotify:album:")) {
    const tracks: MediaItem[] = [];
    for (let offset = 0; tracks.length < limit; offset += 50) {
      const page = await desktopApi.album(uri, { offset, limit: 50 });
      tracks.push(...page.tracks);
      if (!page.hasMore || !page.tracks.length) break;
    }
    return tracks.slice(0, limit);
  }
  const snapshot = await desktopApi.cachedPlaylistSnapshot(uri).catch(() => null) ?? await desktopApi.playlistSnapshot(uri);
  return snapshot.tracks.slice(0, limit);
}
