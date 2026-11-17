import type { LyricsDocument } from "../../types/tauri";
import type { LyricsFallbackReason } from "./lyricsFallbackCache";
import { lyricsErrorCode } from "./useLyricsQuery";

export type LyricsAvailability =
  | "available"
  | "checking"
  | "disabled"
  | "error"
  | "instrumental"
  | "lookup-timeout"
  | "metadata-pending"
  | "metadata-unavailable"
  | "no-track"
  | "not-found";

export interface LyricsLifecycle {
  availability: LyricsAvailability;
  fallbackReason?: LyricsFallbackReason;
  hasLyrics: boolean;
  lyricsAvailable: boolean;
}

export function resolveLyricsLifecycle(input: {
  cachedFallback: LyricsFallbackReason | undefined;
  document: LyricsDocument | undefined;
  error: unknown;
  hasTrack: boolean;
  lyricsEnabled: boolean | undefined;
  lookupTimedOut?: boolean;
  metadataReady: boolean;
  metadataTimedOut?: boolean;
  pending: boolean;
}): LyricsLifecycle {
  const code = lyricsErrorCode(input.error);
  const hasLyrics =
    input.document?.instrumental !== true &&
    (input.document?.lines.length ?? 0) > 0;
  const loadedEmpty =
    Boolean(input.document) &&
    input.document?.instrumental !== true &&
    input.document?.lines.length === 0;

  let availability: LyricsAvailability;
  if (!input.hasTrack) {
    availability = "no-track";
  } else if (input.lyricsEnabled === false) {
    availability = "disabled";
  } else if (hasLyrics) {
    availability = "available";
  } else if (input.document?.instrumental === true) {
    availability = "instrumental";
  } else if (
    loadedEmpty ||
    code === "LYRICS_NOT_FOUND" ||
    code === "INVALID_REQUEST" ||
    (input.cachedFallback === "not-found" && !hasLyrics)
  ) {
    availability = "not-found";
  } else if (
    input.cachedFallback === "temporarily-unavailable" &&
    !hasLyrics
  ) {
    availability = "lookup-timeout";
  } else if (input.lookupTimedOut) {
    availability = "lookup-timeout";
  } else if (input.metadataTimedOut) {
    availability = "metadata-unavailable";
  } else if (!input.metadataReady) {
    availability = "metadata-pending";
  } else if (input.pending || code === "LYRICS_LOOKUP_PENDING") {
    availability = "checking";
  } else if (input.error) {
    availability = "error";
  } else {
    availability = "checking";
  }

  const fallbackReason = resolveFallbackReason(
    availability,
    input.error,
    code,
  );
  const lyricsAvailable = ![
    "disabled",
    "instrumental",
    "lookup-timeout",
    "metadata-unavailable",
    "no-track",
    "not-found",
  ].includes(availability);

  return {
    availability,
    ...(fallbackReason ? { fallbackReason } : {}),
    hasLyrics,
    lyricsAvailable,
  };
}

function resolveFallbackReason(
  availability: LyricsAvailability,
  error: unknown,
  code: string | undefined,
): LyricsFallbackReason | undefined {
  if (availability === "instrumental" || availability === "not-found") {
    return "not-found";
  }
  if (
    availability === "lookup-timeout" ||
    availability === "metadata-unavailable"
  ) {
    return "temporarily-unavailable";
  }
  if (
    error &&
    code !== "INVALID_REQUEST" &&
    code !== "LYRICS_LOOKUP_PENDING"
  ) {
    return "temporarily-unavailable";
  }
  return undefined;
}
