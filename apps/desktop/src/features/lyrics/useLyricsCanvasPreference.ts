import { useCallback, useState } from "react";

const STORAGE_KEY = "luftplayer.lyrics.card-canvas";

/** Whether the lyrics, cover and room views play the Canvas or show the plain cover. */
export function useLyricsCanvasPreference() {
  const [canvasHidden, setCanvasHidden] = useState(readCanvasHidden);
  const toggleCanvas = useCallback(() => {
    setCanvasHidden((hidden) => {
      const next = !hidden;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "cover" : "canvas");
      } catch {
        // Local persistence is optional; the button must keep working regardless.
      }
      return next;
    });
  }, []);
  return { canvasHidden, toggleCanvas };
}

function readCanvasHidden() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "cover";
  } catch {
    return false;
  }
}
