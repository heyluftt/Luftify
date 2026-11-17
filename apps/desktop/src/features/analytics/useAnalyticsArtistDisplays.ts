import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { desktopApi } from "../../services/desktopApi";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import type { AnalyticsCreator, ArtistListeningStat } from "./analyticsTypes";
import { runLibrespotArtistDisplayLookup } from "./artistDisplayLookupLimiter";

const ARTIST_IMAGE_STALE_TIME_MS = 6 * 60 * 60 * 1_000;
const ARTIST_IMAGE_CACHE_TIME_MS = 24 * 60 * 60 * 1_000;

export interface AnalyticsArtistDisplay {
  uri?: string;
  imageUri?: string;
}

interface ArtistLookup {
  key: string;
  creator: AnalyticsCreator;
}

export function analyticsArtistDisplayKey(creator: AnalyticsCreator) {
  return creator.uri ?? `name:${normalizeArtistName(creator.name)}`;
}

export function useAnalyticsArtistDisplays(
  artists: ArtistListeningStat[],
  enabled: boolean,
) {
  const { localReady, engineReady } = usePlaybackEngine();
  const searchProvider = localReady ? "librespot" : "desktop";
  const searchReady = engineReady;

  const lookupModel = useMemo(() => createArtistLookups(artists), [artists]);
  // Artists with a Spotify id: all pictures in one request instead of one search each.
  const knownUris = useMemo(() => portraitUris(artists), [artists]);
  const batchEnabled = enabled && searchProvider === "librespot" && localReady && knownUris.length > 0;
  const portraits = useQuery({ ...artistPortraitsQuery(knownUris), enabled: batchEnabled, refetchOnMount: false, refetchOnWindowFocus: false });
  const portraitByUri = useMemo(() => new Map((portraits.data ?? []).filter((entry) => entry.coverUri).map((entry) => [entry.uri, { uri: entry.uri, imageUri: entry.coverUri! }])), [portraits.data]);
  // The search only runs for what the batch could not answer, and only after it.
  const batchPending = batchEnabled && portraits.isPending;
  const queries = useQueries({
    queries: lookupModel.lookups.map((lookup) => ({
      queryKey: ["analytics", "artist-display", searchProvider, lookup.key],
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        const findDisplay = () => findArtistDisplay(lookup.creator, signal);
        return searchProvider === "librespot"
          ? runLibrespotArtistDisplayLookup(findDisplay, signal)
          : findDisplay();
      },
      enabled: enabled && searchReady && lookup.creator.name.trim().length > 0
        && !batchPending && !(lookup.creator.uri && portraitByUri.has(lookup.creator.uri)),
      staleTime: ARTIST_IMAGE_STALE_TIME_MS,
      gcTime: ARTIST_IMAGE_CACHE_TIME_MS,
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    })),
  });

  const resultByLookup = new Map<string, AnalyticsArtistDisplay>();
  lookupModel.lookups.forEach((lookup, index) => {
    const display = (lookup.creator.uri ? portraitByUri.get(lookup.creator.uri) : undefined) ?? queries[index]?.data;
    if (display) resultByLookup.set(lookup.key, display);
  });

  const displays = new Map<string, AnalyticsArtistDisplay>();
  for (const artist of artists) {
    const sourceKey = analyticsArtistDisplayKey(artist.creator);
    const lookupKey = lookupModel.lookupKeyBySource.get(sourceKey);
    const display = lookupKey ? resultByLookup.get(lookupKey) : undefined;
    if (display) displays.set(sourceKey, display);
  }
  return displays;
}

/** The Spotify ids among the artists, in one stable order (also the cache key). */
export function portraitUris(artists: ArtistListeningStat[]) {
  return [...new Set(createArtistLookups(artists).lookups.flatMap((lookup) => lookup.creator.uri?.startsWith("spotify:artist:") ? [lookup.creator.uri] : []))].sort();
}

export const artistPortraitsQuery = (uris: string[]) => ({
  queryKey: ["analytics", "artist-portraits", uris],
  queryFn: () => desktopApi.artistPortraits(uris),
  staleTime: ARTIST_IMAGE_STALE_TIME_MS,
  gcTime: ARTIST_IMAGE_CACHE_TIME_MS,
  retry: false,
});

function createArtistLookups(artists: ArtistListeningStat[]) {
  const uriByName = new Map<string, string>();
  for (const { creator } of artists) {
    const name = normalizeArtistName(creator.name);
    if (name && creator.uri) uriByName.set(name, creator.uri);
  }

  const lookupsByKey = new Map<string, ArtistLookup>();
  const lookupKeyBySource = new Map<string, string>();
  for (const { creator } of artists) {
    const normalizedName = normalizeArtistName(creator.name);
    const preferredUri = creator.uri ?? uriByName.get(normalizedName);
    const lookupKey = preferredUri ?? `name:${normalizedName}`;
    lookupKeyBySource.set(analyticsArtistDisplayKey(creator), lookupKey);
    if (!lookupsByKey.has(lookupKey)) {
      lookupsByKey.set(lookupKey, {
        key: lookupKey,
        creator: preferredUri
          ? { name: creator.name, uri: preferredUri }
          : { name: creator.name },
      });
    }
  }

  return {
    lookups: [...lookupsByKey.values()],
    lookupKeyBySource,
  };
}

async function findArtistDisplay(
  creator: AnalyticsCreator,
  signal: AbortSignal,
): Promise<AnalyticsArtistDisplay | null> {
  const result = await desktopApi.search({
    query: creator.name.trim(),
    offset: 0,
    limit: 8,
  }, signal);
  const normalizedName = normalizeArtistName(creator.name);
  const match = result.artists.find((artist) => artist.uri === creator.uri)
    ?? result.artists.find((artist) => normalizeArtistName(artist.name) === normalizedName);
  if (!match) return null;

  return {
    uri: match.uri,
    ...(match.coverUri ? { imageUri: match.coverUri } : {}),
  };
}

function normalizeArtistName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
