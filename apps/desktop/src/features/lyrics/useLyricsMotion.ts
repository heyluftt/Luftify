import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  LyricsScrollMotion,
  lyricsScrollTarget,
} from "./lyricsScrollMotion";

interface UseLyricsMotionOptions {
  activeIndex: number;
  activeLineStartMs: number | null | undefined;
  trackKey: string;
  cycle: number;
  enabled: boolean;
  layoutRevision: readonly unknown[] | undefined;
  synced: boolean;
}

export function useLyricsMotion({
  activeIndex,
  activeLineStartMs,
  trackKey,
  cycle,
  enabled,
  layoutRevision,
  synced,
}: UseLyricsMotionOptions) {
  const readerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLButtonElement>(null);
  const motionRef = useRef<LyricsScrollMotion | null>(null);
  const motionReaderRef = useRef<HTMLElement | null>(null);
  const previousContextRef = useRef<{
    activeIndex: number;
    cycle: number;
    trackKey: string;
  } | null>(null);
  const userScrollLockedRef = useRef(false);
  const [followingPaused, setFollowingPaused] = useState(false);
  const recenterRef = useRef<(immediate?: boolean) => void>(() => undefined);

  const ensureMotion = () => {
    const reader = readerRef.current;
    if (!reader) {
      return null;
    }

    if (motionReaderRef.current !== reader) {
      motionRef.current?.destroy();
      motionRef.current = new LyricsScrollMotion(reader);
      motionReaderRef.current = reader;
    }

    return motionRef.current;
  };

  const resolveTarget = () => {
    const reader = readerRef.current;
    const activeLine = activeLineRef.current;

    if (!reader || activeIndex < 0 || !activeLine) {
      return 0;
    }

    const readerBounds = reader.getBoundingClientRect();
    const lineBounds = activeLine.getBoundingClientRect();

    return lyricsScrollTarget({
      readerScrollTop: reader.scrollTop,
      readerScrollHeight: reader.scrollHeight,
      readerClientHeight: reader.clientHeight,
      readerTop: readerBounds.top,
      lineTop: lineBounds.top,
      lineHeight: lineBounds.height,
    });
  };

  recenterRef.current = (immediate = false) => {
    if (!enabled || !synced || userScrollLockedRef.current) {
      return;
    }

    const motion = ensureMotion();
    if (!motion) {
      return;
    }

    motion.retarget(resolveTarget(), immediate);
  };

  useLayoutEffect(() => {
    const previous = previousContextRef.current;
    const contextChanged =
      previous === null ||
      previous.trackKey !== trackKey ||
      previous.cycle !== cycle;

    if (!enabled || !synced) {
      motionRef.current?.destroy();
      motionRef.current = null;
      motionReaderRef.current = null;
      previousContextRef.current = {
        activeIndex,
        cycle,
        trackKey,
      };
      userScrollLockedRef.current = false;
      setFollowingPaused(false);

      if (contextChanged && readerRef.current) {
        readerRef.current.scrollTop = 0;
      }
      return;
    }

    const firstResolvedLine =
      activeIndex >= 0 &&
      (previous === null || previous.activeIndex < 0);

    if (contextChanged) {
      userScrollLockedRef.current = false;
      setFollowingPaused(false);
    }

    previousContextRef.current = {
      activeIndex,
      cycle,
      trackKey,
    };

    recenterRef.current(contextChanged || firstResolvedLine);
  }, [
    activeIndex,
    activeLineStartMs,
    cycle,
    enabled,
    layoutRevision,
    synced,
    trackKey,
  ]);

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || !enabled || !synced) {
      return;
    }

    const pauseForUserScroll = (event: Event) => {
      if (
        event.type === "pointerdown" &&
        event.target !== reader
      ) {
        return;
      }

      userScrollLockedRef.current = true;
      setFollowingPaused(true);
      motionRef.current?.stop();
    };
    const pauseForScrollKey = (event: KeyboardEvent) => {
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "End",
          "Home",
          "PageDown",
          "PageUp",
          " ",
        ].includes(event.key)
      ) {
        pauseForUserScroll(event);
      }
    };

    reader.addEventListener("wheel", pauseForUserScroll, {
      passive: true,
    });
    reader.addEventListener("touchstart", pauseForUserScroll, {
      passive: true,
    });
    reader.addEventListener("pointerdown", pauseForUserScroll);
    reader.addEventListener("keydown", pauseForScrollKey);

    return () => {
      reader.removeEventListener("wheel", pauseForUserScroll);
      reader.removeEventListener("touchstart", pauseForUserScroll);
      reader.removeEventListener("pointerdown", pauseForUserScroll);
      reader.removeEventListener("keydown", pauseForScrollKey);
    };
  }, [enabled, synced]);

  useEffect(() => {
    const reader = readerRef.current;
    const activeLine = activeLineRef.current;
    const lineContainer = activeLine?.parentElement;

    if (
      !reader ||
      !enabled ||
      !synced ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const observer = new ResizeObserver(() => {
      recenterRef.current();
    });
    observer.observe(reader);

    if (lineContainer) {
      observer.observe(lineContainer);
    }

    return () => {
      observer.disconnect();
    };
  }, [activeIndex, enabled, layoutRevision, synced]);

  useEffect(
    () => () => {
      motionRef.current?.destroy();
    },
    [],
  );

  const resumeFollowing = () => {
    userScrollLockedRef.current = false;
    setFollowingPaused(false);
    recenterRef.current();
  };

  return {
    activeLineRef,
    followingPaused,
    readerRef,
    resumeFollowing,
  };
}
