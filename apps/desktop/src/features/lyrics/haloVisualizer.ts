import type { VisualizerFrame } from "../../types/tauri";
import { clampVisualizer } from "./ambientVisualizer";
import type { LyricsAmbientMetrics } from "./lyricsVisualSettings";

const RELEASE_SECONDS = 0.07;
/** How much of the glow the song's loudness holds between hits. */
const HELD_GLOW = 0.12;
/** Added while nothing hits, so a loud held bass still lights up. */
const HELD_WITHOUT_HITS = 0.25;
const HITS_FADE_SECONDS = 4;
const SWELL_BOOST = 1.5;

/** Keeps the angle between frames: hits speed the beams up for a moment. */
export function createHaloMotion(
  metrics: LyricsAmbientMetrics,
): (frame: VisualizerFrame, nowMs: number) => Record<string, string> {
  const baseSpeed = 360 / metrics.beamTurnSeconds;
  const floor = metrics.haloMinOpacity * 0.2;
  let level = 0;
  let hits = 0;
  let turn = 0;
  let last: number | undefined;

  return (frame, nowMs) => {
    const seconds = last === undefined ? 0 : Math.min(0.1, Math.max(0, (nowMs - last) / 1_000));
    last = nowMs;
    const punch = clampVisualizer(Math.max(frame.bass, frame.beat));
    const air = clampVisualizer(frame.high * 0.6 + punch * 0.25);
    level = punch > level
      ? punch
      : level + (punch - level) * (1 - Math.exp(-seconds / RELEASE_SECONDS));
    const strong = clampVisualizer((punch - 0.45) / 0.4);
    hits = Math.max(strong, hits * Math.exp(-seconds / HITS_FADE_SECONDS));
    const held = frame.energy * (HELD_GLOW + HELD_WITHOUT_HITS * (1 - hits));
    const glow = held + (1 - held) * level;
    turn += seconds * baseSpeed * (0.6 + level * 3.5 + frame.energy * 0.6);

    return {
      "--lyrics-viz-halo-opacity": fixed(floor + (metrics.haloMaxOpacity - floor) * glow),
      "--lyrics-viz-halo-scale": fixed(1 + metrics.haloSwell * SWELL_BOOST * level),
      "--lyrics-viz-halo-turn": degrees(turn * 0.55),
      "--lyrics-viz-near-opacity": fixed(metrics.beamOpacity * (0.55 + level * 0.45)),
      "--lyrics-viz-near-turn": degrees(turn),
      "--lyrics-viz-near-width": `${fixed(metrics.beamWidthPx * (0.8 + level * 1.4))}px`,
      "--lyrics-viz-far-opacity": fixed(
        metrics.beamOpacity * Math.min(1, 0.3 + air * 0.6 + level * 0.1),
      ),
      "--lyrics-viz-far-turn": degrees(140 - turn * 0.7),
      "--lyrics-viz-far-width": `${fixed(metrics.beamWidthPx * (0.55 + air))}px`,
    };
  };
}

function fixed(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}

function degrees(value: number): string {
  return `${Math.round((((value % 360) + 360) % 360) * 10) / 10}deg`;
}
