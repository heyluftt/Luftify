import { useEffect, useState } from "react";

/**
 * How long after a page change its cards and first rows may still pop in.
 * Longer than the last staggered entrance (styles/motion/lively.css), so
 * none is cut short; content that mounts later (scrolling) stays still.
 */
const ENTERING_MS = 1100;

/** True for a moment after `key` (the route) changes. */
export function usePageEntering(key: string): boolean {
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    setEntering(true);
    const timer = window.setTimeout(() => setEntering(false), ENTERING_MS);
    return () => window.clearTimeout(timer);
  }, [key]);
  return entering;
}
