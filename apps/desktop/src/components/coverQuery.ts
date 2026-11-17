import type { QueryClient } from "@tanstack/react-query";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { desktopApi } from "../services/desktopApi";
import { sizedCoverUrl, type CoverSize } from "./coverSizing";

/**
 * In the app, covers are plain image URLs on the `luftcover` scheme
 * (src-tauri/src/cover_protocol.rs): served from the disk cache, decoded
 * and cached by the webview, no base64 in the JS heap. Outside Tauri
 * (tests, browser preview) the data-URI path below is used.
 */
export function coverProtocolUrl(original: string, size: CoverSize): string | undefined {
  if (!coverProtocolAvailable()) return undefined;
  const source = sizedCoverUrl(original, size);
  const params = new URLSearchParams({ src: source });
  if (source !== original) params.set("fallback", original);
  const url = `${convertFileSrc("cover", "luftcover")}?${params.toString()}`;
  verifyProtocolOnce(url, original);
  return url;
}

let available: boolean | undefined;
let verification: "pending" | "running" | "done" = "pending";
const listeners = new Set<() => void>();

export function coverProtocolAvailable(): boolean {
  available ??= typeof window !== "undefined" && isTauri();
  return available;
}

/** For useSyncExternalStore: AlbumArt re-renders if the scheme is given up. */
export function subscribeCoverProtocol(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Safety net: the first cover on the scheme is loaded once more as an
 * image. If that fails while the data-URI path works for the same cover,
 * the scheme is broken on this system and every cover falls back to the
 * previous path for the session instead of staying blank.
 */
function verifyProtocolOnce(url: string, original: string) {
  if (verification !== "pending") return;
  verification = "running";
  const image = new Image();
  image.onload = () => { verification = "done"; };
  image.onerror = () => {
    desktopApi.coverData(original).then(() => {
      verification = "done";
      available = false;
      listeners.forEach((listener) => listener());
    }, () => {
      // Neither path works (offline, cover gone): decide with the next cover.
      verification = "pending";
    });
  };
  image.src = url;
}

/** Warms a cover in the background, in whichever form AlbumArt will use. */
export function prefetchCover(queryClient: QueryClient, original: string, size: CoverSize): Promise<unknown> {
  const url = coverProtocolUrl(original, size);
  if (!url) return queryClient.prefetchQuery(coverQueryOptions(original, size));
  return new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = image.onerror = () => resolve();
    image.src = url;
  });
}

/**
 * One cache entry per (sized) cover URL, shared by AlbumArt and the
 * prefetcher so both hit the same key. A size variant Spotify does not
 * have falls back to the original URL.
 */
export function coverQueryOptions(original: string, size: CoverSize) {
  const remote = sizedCoverUrl(original, size);
  return {
    queryKey: ["cover", remote] as const,
    queryFn: async () => {
      try {
        return await desktopApi.coverData(remote);
      } catch (error) {
        if (remote !== original) return desktopApi.coverData(original);
        throw error;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  };
}

/** A cover already in the cache at this size, or the original as a stand-in. */
export function cachedCover(queryClient: QueryClient, original: string, size: CoverSize): string | undefined {
  const remote = sizedCoverUrl(original, size);
  return queryClient.getQueryData<string>(["cover", remote])
    ?? (remote !== original ? queryClient.getQueryData<string>(["cover", original]) : undefined);
}
