import { useCallback, useState } from "react";

const STORAGE_KEY = "luftplayer.room.lyrics";

/** Whether the music room shows the lyrics on its left; shown unless turned off. */
export function useRoomLyricsPreference() {
  const [lyricsHidden, setLyricsHidden] = useState(readHidden);
  const toggleLyrics = useCallback(() => {
    setLyricsHidden((hidden) => {
      const next = !hidden;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "hidden" : "shown");
      } catch {
        // Local persistence is optional; the button must keep working regardless.
      }
      return next;
    });
  }, []);
  return { lyricsHidden, toggleLyrics };
}

function readHidden() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "hidden";
  } catch {
    return false;
  }
}
