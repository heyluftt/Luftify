import { useEffect, useState } from "react";

const IDLE_AFTER_MS = 2_600;

/**
 * True once the pointer and keyboard rested for a moment while `active`.
 * Full screen uses it to hide its controls and the cursor, like a video player.
 */
export function usePointerIdle(active: boolean): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!active) {
      setIdle(false);
      return;
    }
    let timer = window.setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
    for (const name of events) window.addEventListener(name, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, wake);
    };
  }, [active]);

  return active && idle;
}
