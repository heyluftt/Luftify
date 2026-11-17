import {
  useCallback,
  useState,
} from "react";

export type LyricsViewMode = "lyrics" | "cover" | "room";

const STORAGE_KEY = "luftplayer.lyrics.view-mode";

export function useLyricsViewMode(lyricsAvailable: boolean) {
  const [preferredMode, setPreferredMode] =
    useState<LyricsViewMode>(readPreferredMode);

  const setMode = useCallback((mode: LyricsViewMode) => {
    setPreferredMode(mode);

    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // A blocked storage backend must not make the view unusable.
    }
  }, []);

  const mode: LyricsViewMode = preferredMode === "room" ? "room" : lyricsAvailable ? preferredMode : "cover";
  return {
    lyricsAvailable,
    mode,
    setMode,
  };
}

function readPreferredMode(): LyricsViewMode {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "cover" || saved === "room" ? saved : "lyrics";
  } catch {
    return "lyrics";
  }
}
