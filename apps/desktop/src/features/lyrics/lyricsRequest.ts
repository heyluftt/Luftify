import { desktopApi } from "../../services/desktopApi";
import type {
  CommandError,
  LyricsDocument,
  LyricsRequest,
} from "../../types/tauri";

// The native command has its own 18 second deadline. Keep a slightly wider
// renderer-side guard so an IPC edge case can never leave React Query pending
// forever, while normal native timeout errors still reach the UI unchanged.
const LYRICS_REQUEST_DEADLINE_MS = 20_000;

export function requestLyrics(
  request: LyricsRequest,
): Promise<LyricsDocument> {
  return rejectAfter(
    desktopApi.lyrics(request),
    LYRICS_REQUEST_DEADLINE_MS,
    lyricsTimeoutError(),
  );
}

function rejectAfter<T>(
  request: Promise<T>,
  durationMs: number,
  error: CommandError,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(error), durationMs);
    request.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

function lyricsTimeoutError(): CommandError {
  return {
    code: "LYRICS_LOOKUP_TIMEOUT",
    message: "Die Songtextsuche hat zu lange gedauert.",
    retryable: true,
  };
}
