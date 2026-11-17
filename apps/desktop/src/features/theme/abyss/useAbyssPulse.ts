import { useEffect, type RefObject } from "react";
import { desktopApi } from "../../../services/desktopApi";
import { usePlayerStore } from "../../../stores/playerStore";
import type { VisualizerFrame } from "../../../types/tauri";
import {
  EMPTY_VISUALIZER_FRAME,
  shapeVisualizerFrame,
  smoothVisualizerFrame,
} from "../../lyrics/ambientVisualizer";
import { useAbyssMusic } from "./abyssMusic";

/** The latest levels, read each frame by the particle canvas. */
export const abyssLevels = { pulse: 0, energy: 0 };

/** About 15 updates a second: enough for light swelling with the music. */
const STEP_MS = 66;
const SENSITIVITY = 60;

/**
 * Writes `--abyss-pulse` (beat and bass) and `--abyss-energy` onto the scene
 * while music plays, from Libre's live levels. Idle, paused, minimised or
 * with reduced motion it rests at 0.
 */
export function useAbyssPulse(target: RefObject<HTMLElement | null>, active: boolean) {
  const enabled = useAbyssMusic((state) => state.enabled);
  const playing = usePlayerStore((store) => Boolean(store.playback?.isPlaying));

  useEffect(() => {
    const element = target.current;
    if (!active || !element) return;
    // Every write restyles the whole scene, so only noticeable changes go out.
    let written = { pulse: -1, energy: -1 };
    const write = (frame: VisualizerFrame) => {
      abyssLevels.pulse = Math.max(frame.beat, frame.bass);
      abyssLevels.energy = frame.energy;
      if (Math.abs(abyssLevels.pulse - written.pulse) < 0.02 && Math.abs(abyssLevels.energy - written.energy) < 0.02) return;
      written = { ...abyssLevels };
      element.style.setProperty("--abyss-pulse", abyssLevels.pulse.toFixed(2));
      element.style.setProperty("--abyss-energy", abyssLevels.energy.toFixed(2));
    };
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (!enabled || !playing || reduced) {
      write(EMPTY_VISUALIZER_FRAME);
      return;
    }
    let cancelled = false;
    let envelope = EMPTY_VISUALIZER_FRAME;
    let last = performance.now();
    const step = async () => {
      // Nothing to see while hidden or minimised (windowActivity.ts).
      if (document.hidden || document.documentElement.hasAttribute("data-window-idle")) return;
      const now = performance.now();
      const seconds = Math.min(0.2, (now - last) / 1000);
      last = now;
      let target: VisualizerFrame = EMPTY_VISUALIZER_FRAME;
      const snapshot = await desktopApi.visualizerFrame().catch(() => undefined);
      if (cancelled) return;
      if (snapshot?.source === "live") target = shapeVisualizerFrame(snapshot, SENSITIVITY);
      envelope = smoothVisualizerFrame(envelope, target, seconds);
      write(envelope);
    };
    const timer = window.setInterval(() => void step(), STEP_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      write(EMPTY_VISUALIZER_FRAME);
    };
  }, [active, enabled, playing, target]);
}
