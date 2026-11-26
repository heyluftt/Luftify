import { useEffect } from "react";
import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";
import { shapeVisualizerFrame } from "../lyrics/ambientVisualizer";
import { useLessMotion } from "../motion/motionLevel";

/** Read by theme scenes every frame. */
export interface MusicLevels { bass: number; high: number; beat: number; energy: number }

export function createMusicLevels(): MusicLevels {
  return { bass: 0, high: 0, beat: 0, energy: 0 };
}

const STEP_MS = 66;
const SENSITIVITY = 62;
const HIT_FADE_SECONDS = 0.2;
const HAT_FADE_SECONDS = 0.1;
const ENERGY_SECONDS = 0.3;

function reset(levels: MusicLevels) {
  levels.bass = 0;
  levels.high = 0;
  levels.beat = 0;
  levels.energy = 0;
}

/** Live levels from Libre into `levels` while music plays; at rest otherwise. */
export function useMusicLevels(levels: MusicLevels, active: boolean, enabled: boolean) {
  const playing = usePlayerStore((store) => Boolean(store.playback?.isPlaying));
  const still = useLessMotion();

  useEffect(() => {
    if (!active || !enabled || !playing || still) {
      reset(levels);
      return;
    }
    let cancelled = false;
    let last = performance.now();
    const step = async () => {
      if (document.hidden || document.documentElement.hasAttribute("data-window-idle")) return;
      const now = performance.now();
      const seconds = Math.min(0.2, (now - last) / 1000);
      last = now;
      const snapshot = await desktopApi.visualizerFrame().catch(() => undefined);
      if (cancelled) return;
      const frame = snapshot?.source === "live" ? shapeVisualizerFrame(snapshot, SENSITIVITY) : undefined;
      const fade = Math.exp(-seconds / HIT_FADE_SECONDS);
      levels.bass = Math.max(frame?.bass ?? 0, levels.bass * fade);
      levels.beat = Math.max(frame?.beat ?? 0, levels.beat * fade);
      levels.high = Math.max(frame?.high ?? 0, levels.high * Math.exp(-seconds / HAT_FADE_SECONDS));
      levels.energy += ((frame?.energy ?? 0) - levels.energy) * (1 - Math.exp(-seconds / ENERGY_SECONDS));
    };
    const timer = window.setInterval(() => void step(), STEP_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      reset(levels);
    };
  }, [active, enabled, levels, playing, still]);
}
