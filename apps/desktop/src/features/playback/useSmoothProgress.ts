import { useEffect, useRef, type RefObject } from "react";

export const PROGRESS_FORWARD_SEEK_MS = 750;
export const PROGRESS_MAX_LEAD_MS = 250;
export const PROGRESS_OVERSHOOT_SNAP_MS = 400;

export function progressRatio(positionMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, positionMs / durationMs));
}

export function applyProgressTransform(
  node: HTMLElement,
  positionMs: number,
  durationMs: number,
): void {
  node.style.transform = `scaleX(${progressRatio(positionMs, durationMs)})`;
}

export function resolveVisualProgress(
  startMs: number,
  origin: number,
  now: number,
  authoritativeMs: number,
  durationMs: number,
): { visualMs: number; startMs: number; origin: number } {
  const duration = Math.max(0, durationMs);
  const authoritative = Math.max(0, authoritativeMs);
  const elapsed = Math.max(0, now - origin);
  let visual = startMs + elapsed;
  if (duration > 0) {
    visual = Math.min(duration, visual);
  }

  if (authoritative - visual >= PROGRESS_FORWARD_SEEK_MS) {
    return { visualMs: authoritative, startMs: authoritative, origin: now };
  }
  if (visual - authoritative >= PROGRESS_OVERSHOOT_SNAP_MS) {
    return { visualMs: authoritative, startMs: authoritative, origin: now };
  }

  visual = Math.min(visual, authoritative + PROGRESS_MAX_LEAD_MS);
  if (duration > 0) {
    visual = Math.min(visual, duration);
  }
  return { visualMs: Math.max(0, visual), startMs, origin };
}

/** Fastest and slowest step of a pixel-stepped bar. */
const PIXEL_STEP_MIN_MS = 100;
const PIXEL_STEP_MAX_MS = 1_000;

/**
 * How long the bar needs to move one device pixel, so a stepped bar looks
 * the same as one repainted every frame.
 */
export function pixelStepMs(durationMs: number, trackWidthPx: number): number {
  if (durationMs <= 0 || trackWidthPx <= 0) return PIXEL_STEP_MAX_MS;
  return Math.min(PIXEL_STEP_MAX_MS, Math.max(PIXEL_STEP_MIN_MS, durationMs / trackWidthPx));
}

export function useSmoothProgress(
  element: RefObject<HTMLElement | null>,
  input: {
    positionMs: number;
    durationMs: number;
    running: boolean;
    trackKey?: string;
    /**
     * Move only when the bar gains a device pixel instead of every frame.
     * For windows beside the main one (the mini player): painting at the
     * display rate there (165 Hz) starved the main window's Canvas video,
     * which shares WebView2's GPU process, down to a stutter.
     */
    pixelStep?: boolean;
  },
): void {
  const latest = useRef(input);
  latest.current = input;

  useEffect(() => {
    const node = element.current;
    if (!node) return;

    let origin = performance.now();
    let startMs = Math.max(0, latest.current.positionMs);
    applyProgressTransform(node, startMs, latest.current.durationMs);

    if (!latest.current.running || latest.current.durationMs <= 0) {
      return;
    }

    let frame = 0;
    let timer = 0;
    const stepped = latest.current.pixelStep === true;
    const schedule = () => {
      if (!stepped) {
        frame = window.requestAnimationFrame(paint);
        return;
      }
      const track = node.parentElement?.getBoundingClientRect().width ?? 0;
      const delay = pixelStepMs(latest.current.durationMs, track * (window.devicePixelRatio || 1));
      timer = window.setTimeout(() => paint(performance.now()), delay);
    };
    const paint = (now: number) => {
      const next = resolveVisualProgress(
        startMs,
        origin,
        now,
        latest.current.positionMs,
        latest.current.durationMs,
      );
      startMs = next.startMs;
      origin = next.origin;
      applyProgressTransform(node, next.visualMs, latest.current.durationMs);
      if (latest.current.running && next.visualMs < latest.current.durationMs) {
        schedule();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      startMs = Math.max(0, latest.current.positionMs);
      origin = performance.now();
      applyProgressTransform(node, startMs, latest.current.durationMs);
    };

    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [element, input.durationMs, input.running, input.trackKey]);

  useEffect(() => {
    const node = element.current;
    if (!node || input.running) return;
    applyProgressTransform(node, input.positionMs, input.durationMs);
  }, [element, input.durationMs, input.positionMs, input.running]);
}
