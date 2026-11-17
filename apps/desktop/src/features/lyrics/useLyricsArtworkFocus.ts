import { useCallback, useState } from "react";

const STORAGE_KEY = "luftplayer.lyrics.artwork-focus";

export function useLyricsArtworkFocus() {
  const [detailsHidden, setDetailsHidden] = useState(readDetailsHidden);
  const toggleDetails = useCallback(() => {
    setDetailsHidden((hidden) => {
      const next = !hidden;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "hidden" : "visible");
      } catch {
        // Local persistence is optional; the button must keep working regardless.
      }
      return next;
    });
  }, []);
  return { detailsHidden, toggleDetails };
}

function readDetailsHidden() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "hidden";
  } catch {
    return false;
  }
}
