import { useEffect, useRef } from "react";
import { motionLevel, type MotionLevel } from "../motion/motionLevel";

/**
 * Calls `onArrive` when the root switches to `themeId` while the app is open
 * (not at the start, not with motion off). Runs inside the observer, so it
 * comes before the new colours are painted.
 */
export function useThemeArrival(themeId: string, onArrive: (level: Exclude<MotionLevel, "off">) => void) {
  const callback = useRef(onArrive);
  callback.current = onArrive;

  useEffect(() => {
    const root = document.documentElement;
    let previous = root.dataset.theme;
    const observer = new MutationObserver(() => {
      const next = root.dataset.theme;
      if (next === previous) return;
      const arrived = next === themeId && previous !== undefined;
      previous = next;
      const level = motionLevel();
      if (!arrived || level === "off" || root.hasAttribute("data-start")) return;
      callback.current(level);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [themeId]);
}
