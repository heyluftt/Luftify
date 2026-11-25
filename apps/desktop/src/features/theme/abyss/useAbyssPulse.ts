import { useEffect, type RefObject } from "react";
import { desktopApi } from "../../../services/desktopApi";
import { usePlayerStore } from "../../../stores/playerStore";
import { shapeVisualizerFrame } from "../../lyrics/ambientVisualizer";
import { useAbyssMusic } from "./abyssMusic";

/** The latest levels, read each frame by the particle canvas. */
export const abyssLevels = { pulse: 0, energy: 0 };

/** About 15 updates a second: enough for light swelling with the music. */
const STEP_MS = 66;
const SENSITIVITY = 60;
/** Hits are shorter than a step, so the pulse is held and fades. */
const PULSE_FADE_SECONDS = 0.22;
const ENERGY_SECONDS = 0.2;

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
    const write = (pulse: number, energy: number) => {
      abyssLevels.pulse = pulse;
      abyssLevels.energy = energy;
      if (Math.abs(abyssLevels.pulse - written.pulse) < 0.02 && Math.abs(abyssLevels.energy - written.energy) < 0.02) return;
      written = { ...abyssLevels };
      element.style.setProperty("--abyss-pulse", abyssLevels.pulse.toFixed(2));
      element.style.setProperty("--abyss-energy", abyssLevels.energy.toFixed(2));
    };
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (!enabled || !playing || reduced) {
      write(0, 0);
      return;
    }
    let cancelled = false;
    let pulse = 0;
    let energy = 0;
    let last = performance.now();
    const step = async () => {
      // Nothing to see while hidden or minimised (windowActivity.ts).
      if (document.hidden || document.documentElement.hasAttribute("data-window-idle")) return;
      const now = performance.now();
      const seconds = Math.min(0.2, (now - last) / 1000);
      last = now;
      const snapshot = await desktopApi.visualizerFrame().catch(() => undefined);
      if (cancelled) return;
      const frame = snapshot?.source === "live" ? shapeVisualizerFrame(snapshot, SENSITIVITY) : undefined;
      const hit = frame ? Math.max(frame.beat, frame.bass) : 0;
      pulse = Math.max(hit, pulse * Math.exp(-seconds / PULSE_FADE_SECONDS));
      energy += ((frame?.energy ?? 0) - energy) * (1 - Math.exp(-seconds / ENERGY_SECONDS));
      write(pulse, energy);
    };
    const timer = window.setInterval(() => void step(), STEP_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      write(0, 0);
    };
  }, [active, enabled, playing, target]);
}
