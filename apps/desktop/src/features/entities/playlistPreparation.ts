import type { PlaylistDetails } from "@luft/protocol-types";
import { playlistPlaceholderCount } from "./playlistSnapshot";

const MAX_SNAPSHOT_PASSES = 50;
const MAX_STAGNANT_PASSES = 3;
const COVER_CONCURRENCY = 4;

export interface PlaylistPreparationProgress {
  stage: "tracks" | "covers";
  completed: number;
  total: number;
}

export interface PlaylistPreparationResult {
  snapshot: PlaylistDetails;
  preparedTracks: number;
  unavailableTracks: number;
}

interface PlaylistPreparationOptions {
  signal?: AbortSignal;
  loadSnapshot: (uri: string) => Promise<PlaylistDetails>;
  loadCover: (url: string) => Promise<unknown>;
  onSnapshot?: (snapshot: PlaylistDetails) => void;
  onProgress?: (progress: PlaylistPreparationProgress) => void;
}

export async function preparePlaylistAssets(
  uri: string,
  options: PlaylistPreparationOptions,
): Promise<PlaylistPreparationResult> {
  let snapshot: PlaylistDetails | undefined;
  let previousSignature = "";
  let stagnantPasses = 0;
  let settled = false;

  for (let pass = 0; pass < MAX_SNAPSHOT_PASSES; pass += 1) {
    throwIfAborted(options.signal);
    snapshot = await options.loadSnapshot(uri);
    options.onSnapshot?.(snapshot);

    const total = Math.max(snapshot.total ?? snapshot.tracks.length, snapshot.tracks.length);
    const placeholders = playlistPlaceholderCount(snapshot);
    options.onProgress?.({
      stage: "tracks",
      completed: Math.max(0, snapshot.tracks.length - placeholders),
      total,
    });

    if (!snapshot.hasMore && placeholders === 0) {
      settled = true;
      break;
    }

    const signature = `${snapshot.tracks.length}:${placeholders}:${snapshot.hasMore}`;
    stagnantPasses = signature === previousSignature ? stagnantPasses + 1 : 0;
    previousSignature = signature;
    if (stagnantPasses >= MAX_STAGNANT_PASSES) {
      if (snapshot.tracks.length > placeholders) {
        settled = true;
        break;
      }
      throw new Error("Keine Titeldaten konnten vorbereitet werden.");
    }
  }

  if (!snapshot) {
    throw new Error("Die Playlist konnte nicht vorbereitet werden.");
  }
  const total = Math.max(snapshot.total ?? snapshot.tracks.length, snapshot.tracks.length);
  const placeholders = playlistPlaceholderCount(snapshot);
  const preparedTracks = Math.max(0, snapshot.tracks.length - placeholders);
  if (!settled) {
    throw new Error("Die Playlist ist noch nicht vollständig verfügbar.");
  }

  const covers = uniqueHttpsCovers(snapshot);
  let completedCovers = 0;
  options.onProgress?.({ stage: "covers", completed: 0, total: covers.length });
  let cursor = 0;
  const worker = async () => {
    while (cursor < covers.length) {
      throwIfAborted(options.signal);
      const cover = covers[cursor++];
      if (!cover) continue;
      try {
        await options.loadCover(cover);
      } catch {
        // A missing cover must not invalidate otherwise complete playlist data.
      }
      completedCovers += 1;
      options.onProgress?.({
        stage: "covers",
        completed: completedCovers,
        total: covers.length,
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(COVER_CONCURRENCY, covers.length) }, () => worker()),
  );
  return {
    snapshot,
    preparedTracks,
    unavailableTracks: Math.max(0, total - preparedTracks),
  };
}

function uniqueHttpsCovers(snapshot: PlaylistDetails): string[] {
  const covers = new Set<string>();
  for (const coverUri of [snapshot.coverUri, ...snapshot.tracks.map((track) => track.coverUri)]) {
    const url = coverUri?.trim();
    if (url?.startsWith("https://")) covers.add(url);
  }
  return [...covers];
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Vorbereitung abgebrochen", "AbortError");
}
