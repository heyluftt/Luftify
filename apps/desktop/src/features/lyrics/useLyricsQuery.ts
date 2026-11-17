import { useQuery } from "@tanstack/react-query";
import type { MediaItem } from "@luft/protocol-types";
import { useEffect, useMemo, useState } from "react";
import { desktopApi } from "../../services/desktopApi";
import type { CommandError, LyricsRequest } from "../../types/tauri";
import {
  lyricsFallbackCacheKey,
  readLyricsFallback,
} from "./lyricsFallbackCache";
import { requestLyrics } from "./lyricsRequest";

const MINIMUM_LYRICS_DURATION_MS = 15_000;
const DURATION_KEY_STEP_MS = 1_000;
const METADATA_WAIT_TIMEOUT_MS = 8_000;
const TRACK_LOOKUP_DEADLINE_MS = 12_000;

export function useLyricsQuery(
  item: MediaItem | undefined,
  playbackDurationMs?: number,
) {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: desktopApi.settings,
  });
  const request = useMemo(
    () => buildLyricsRequest(item, playbackDurationMs),
    [item, playbackDurationMs],
  );
  const fallbackCacheKey = lyricsFallbackCacheKey(item?.uri);
  const cachedFallback = readLyricsFallback(fallbackCacheKey);
  const trackKey = item?.uri.trim() || undefined;
  const [lookupDeadline, setLookupDeadline] = useState<{
    expired: boolean;
    trackKey: string | undefined;
  }>({ expired: false, trackKey: undefined });
  useEffect(() => {
    setLookupDeadline({ expired: false, trackKey });
    if (!trackKey) {
      return;
    }

    const timer = window.setTimeout(
      () => setLookupDeadline({ expired: true, trackKey }),
      TRACK_LOOKUP_DEADLINE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [trackKey]);
  const [metadataTimedOut, setMetadataTimedOut] = useState(false);
  useEffect(() => {
    setMetadataTimedOut(false);
    if (!item || request) {
      return;
    }

    const timer = window.setTimeout(
      () => setMetadataTimedOut(true),
      METADATA_WAIT_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [item?.uri, request]);
  const lyrics = useQuery({
    queryKey: lyricsQueryKey(request, item?.uri),
    queryFn: () => {
      if (!request) {
        throw new Error("Lyrics were requested before track metadata was ready.");
      }
      return requestLyrics(request);
    },
    enabled:
      Boolean(request) &&
      !cachedFallback &&
      settings.isSuccess &&
      settings.data.lyricsEnabled !== false,
    staleTime: 30 * 60_000,
    // A known miss is presented as Cover immediately. A query without an
    // in-memory result still runs quietly; an existing failed query is not
    // repeated merely because the user opens the lyrics page.
    refetchOnMount: false,
    // If background prefetch already completed with an error, opening the
    // page should display that result. Only the visible retry button starts a
    // new lookup.
    retryOnMount: false,
    // One lookup already checks every provider. Repeating that full chain
    // invisibly keeps isPending=true for a long time and does not help a
    // provider that is still preparing its result. The visible retry remains.
    retry: false,
  });

  return {
    cachedFallback,
    fallbackCacheKey,
    lyrics,
    lookupTimedOut:
      lookupDeadline.trackKey === trackKey && lookupDeadline.expired,
    metadataReady: request !== undefined,
    metadataTimedOut,
    request,
    settings,
  };
}

export function buildLyricsRequest(
  item: MediaItem | undefined,
  playbackDurationMs?: number,
): LyricsRequest | undefined {
  if (!item) {
    return undefined;
  }

  const trackUri = item.uri.trim();
  const trackName = item.title.trim();
  const artistNames = uniqueArtistNames(
    item.creators.map((creator) => creator.name),
  );
  const durationMs =
    roundedDuration(item.durationMs) ??
    roundedDuration(playbackDurationMs);

  if (
    !trackUri ||
    !trackName ||
    artistNames.length === 0 ||
    durationMs === undefined
  ) {
    return undefined;
  }

  const albumName = item.albumName?.trim() || trackName;
  const coverUri = item.coverUri?.trim();

  return {
    trackUri,
    trackName,
    artistName: artistNames[0]!,
    artistNames,
    albumName,
    durationMs,
    ...(coverUri ? { coverUri } : {}),
  };
}

export function lyricsQueryKey(
  request: LyricsRequest | undefined,
  pendingTrackUri = "none",
) {
  if (!request) {
    return ["lyrics", "metadata-pending", pendingTrackUri] as const;
  }

  const spotifyTrackUri = request.trackUri.trim();
  if (spotifyTrackUri.startsWith("spotify:track:")) {
    // Libre can enrich title, album, artists and duration after playback has
    // already started. Spotify's URI is the stable identity; including the
    // changing metadata here would restart the same lyrics lookup.
    return ["lyrics", spotifyTrackUri] as const;
  }

  return [
    "lyrics",
    request.trackUri,
    normalizeKeyText(request.trackName),
    request.artistNames.map(normalizeKeyText).join("|"),
    normalizeKeyText(request.albumName),
    Math.round(request.durationMs / DURATION_KEY_STEP_MS),
  ] as const;
}

export function lyricsErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error
    ? String((error as CommandError).code)
    : undefined;
}

function roundedDuration(value: number | undefined): number | undefined {
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    value < MINIMUM_LYRICS_DURATION_MS
  ) {
    return undefined;
  }

  return Math.round(value / DURATION_KEY_STEP_MS) * DURATION_KEY_STEP_MS;
}

function uniqueArtistNames(values: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const value of values) {
    const name = value.trim();
    const key = normalizeKeyText(name);
    if (!name || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(name);
  }

  return names;
}

function normalizeKeyText(value: string): string {
  return value.trim().toLowerCase();
}
