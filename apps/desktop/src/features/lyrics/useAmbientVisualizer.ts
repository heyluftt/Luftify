import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";
import type {
  LyricsVisualMode,
  VisualizerFrame,
} from "../../types/tauri";
import {
  applyVisualizerVars,
  createVisualizerFollower,
  hasVisualizerSignal,
  waveVisualizerVars,
} from "./ambientVisualizer";
import { createHaloMotion } from "./haloVisualizer";
import { lyricsAmbientMetrics } from "./lyricsVisualSettings";
import { prefersLessMotion } from "../motion/motionLevel";

const POLL_MS = 16;

export function useAmbientVisualizer({
  enabled,
  playing,
  mode,
  spreadPercent,
  colorStrengthPercent,
  sensitivityPercent,
  target,
}: {
  enabled: boolean;
  playing: boolean;
  mode: LyricsVisualMode;
  spreadPercent: number;
  colorStrengthPercent: number;
  sensitivityPercent: number;
  target: RefObject<HTMLElement | null>;
}): boolean {
  const [active, setActive] = useState(false);
  const trackUri = usePlayerStore((store) => store.playback?.currentItem?.uri);
  const storePositionMs = usePlayerStore((store) => store.playback?.positionMs ?? 0);
  const positionRef = useRef(storePositionMs);
  const lastVarsRef = useRef<Record<string, string>>({});
  const sensitivityRef = useRef(sensitivityPercent);
  positionRef.current = storePositionMs;
  sensitivityRef.current = sensitivityPercent;

  useLayoutEffect(() => {
    const element = target.current;
    if (!element || Object.keys(lastVarsRef.current).length === 0) {
      return;
    }
    applyVisualizerVars(element, lastVarsRef.current);
  });

  useEffect(() => {
    if (!enabled || !playing || prefersReducedMotion()) {
      setActive(false);
      return;
    }

    const element = target.current;
    if (!element) {
      setActive(false);
      return;
    }

    const metrics = lyricsAmbientMetrics({
      enabled: true,
      mode,
      spreadPercent,
      colorStrengthPercent,
    });
    const halo = createHaloMotion(metrics);
    let cancelled = false;
    let frameId = 0;
    let inFlight = false;
    let lastPollAt = 0;
    const follower = createVisualizerFollower();
    let latched = false;

    const apply = (frame: VisualizerFrame, now: number) => {
      if (!hasVisualizerSignal(frame) && !latched) {
        return;
      }
      if (!latched) {
        latched = true;
        setActive(true);
      }
      const vars = mode === "waves"
        ? waveVisualizerVars(frame, metrics, now)
        : halo(frame, now);
      lastVarsRef.current = vars;
      applyVisualizerVars(element, vars);
    };

    const tick = (now: number) => {
      if (cancelled) {
        return;
      }
      frameId = window.requestAnimationFrame(tick);
      if (document.hidden) {
        return;
      }

      apply(follower.step(now), now);
      if (inFlight || now - lastPollAt < POLL_MS) {
        return;
      }
      lastPollAt = now;
      inFlight = true;
      void desktopApi
        .visualizerFrame()
        .then((snapshot) => {
          if (cancelled || snapshot.source !== "live") {
            return;
          }
          follower.push(snapshot, sensitivityRef.current);
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      lastVarsRef.current = {};
      setActive(false);
    };
  }, [
    colorStrengthPercent,
    enabled,
    mode,
    playing,
    sensitivityPercent,
    spreadPercent,
    target,
    trackUri,
  ]);

  return active;
}

function prefersReducedMotion(): boolean {
  return prefersLessMotion();
}

