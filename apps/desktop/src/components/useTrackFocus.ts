import { useEffect, useRef, useState, type RefObject } from "react";
import { prefersLessMotion } from "../features/motion/motionLevel";

interface TrackFocusOptions {
  listRef: RefObject<HTMLDivElement | null>;
  scrollParent: HTMLElement | null;
  scrollMargin: number;
  focusIndex: number;
  focusRequest: { requestId: string } | undefined;
  useVirtualRows: boolean;
  virtualizer: { scrollToIndex(index: number, options: { align: "center" }): void };
}

/** Keep a requested track visible as background data changes its sorted index.
 * Explicit user interaction releases the anchor until the next request. */
export function useTrackFocus({
  listRef, scrollParent, scrollMargin, focusIndex, focusRequest,
  useVirtualRows, virtualizer,
}: TrackFocusOptions) {
  const requestId = focusRequest?.requestId;
  const cancelled = useRef<string | undefined>(undefined);
  const applied = useRef<{ requestId: string; index: number; margin: number } | undefined>(undefined);
  const [flashIndex, setFlashIndex] = useState<number>();

  useEffect(() => {
    if (!scrollParent || !requestId) return;
    const release = () => { cancelled.current = requestId; };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Tab"].includes(event.key)) {
        release();
      }
    };
    scrollParent.addEventListener("wheel", release, { passive: true });
    scrollParent.addEventListener("touchstart", release, { passive: true });
    scrollParent.addEventListener("pointerdown", release);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      scrollParent.removeEventListener("wheel", release);
      scrollParent.removeEventListener("touchstart", release);
      scrollParent.removeEventListener("pointerdown", release);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [scrollParent, requestId]);

  useEffect(() => {
    if (focusIndex < 0 || !requestId || cancelled.current === requestId) return;
    const previous = applied.current;
    const correction = previous?.requestId === requestId;
    if (correction && previous.index === focusIndex && previous.margin === scrollMargin) return;
    // The shell's navigation reset must finish before either kind of jump.
    const frame = requestAnimationFrame(() => {
      if (cancelled.current === requestId) return;
      if (useVirtualRows) {
        virtualizer.scrollToIndex(focusIndex, { align: "center" });
      } else {
        const row = listRef.current?.querySelector<HTMLElement>(
          `[data-track-index="${focusIndex}"]`,
        );
        if (!row) return;
        row.scrollIntoView({
          behavior: correction || prefersLessMotion()
            ? "auto" : "smooth",
          block: "center",
        });
      }
      applied.current = { requestId, index: focusIndex, margin: scrollMargin };
      setFlashIndex(focusIndex);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusIndex, requestId, scrollMargin, useVirtualRows, virtualizer, listRef]);

  useEffect(() => {
    if (flashIndex === undefined) return;
    const timer = setTimeout(() => setFlashIndex(undefined), 1_800);
    return () => clearTimeout(timer);
  }, [flashIndex]);

  return flashIndex;
}
