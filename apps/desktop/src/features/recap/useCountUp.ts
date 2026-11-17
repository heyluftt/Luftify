import { useEffect, useState } from "react";
import { prefersLessMotion } from "../motion/motionLevel";

/** Counts from 0 to `target` with an ease-out; instant with reduced motion. */
export function useCountUp(target: number, active: boolean, durationMs = 1_400): number {
  const reduced = typeof window !== "undefined" && prefersLessMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (!active) return;
    if (reduced || target <= 0) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    setValue(0);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, durationMs, reduced, target]);
  return value;
}
