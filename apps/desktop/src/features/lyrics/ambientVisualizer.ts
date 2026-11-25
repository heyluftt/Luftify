import type {
  VisualizerAnalysis,
  VisualizerFrame,
} from "../../types/tauri";
import type { LyricsAmbientMetrics } from "./lyricsVisualSettings";

export const EMPTY_VISUALIZER_FRAME: VisualizerFrame = {
  energy: 0,
  bass: 0,
  mid: 0,
  high: 0,
  beat: 0,
};

export const UNAVAILABLE_VISUALIZER_ANALYSIS: VisualizerAnalysis = {
  available: false,
  source: "spotifyAnalysis",
  durationMs: 0,
  tempo: 0,
  beats: [],
  energy: [],
};

const BEAT_ATTACK_MS = 16;
const BEAT_DECAY_MS = 108;
const ENERGY_FLUX_MS = 36;

export function clampVisualizer(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function frameFromAnalysis(
  analysis: VisualizerAnalysis | undefined,
  positionMs: number,
): VisualizerFrame {
  if (!analysis?.available || !Number.isFinite(positionMs) || positionMs < 0) {
    return EMPTY_VISUALIZER_FRAME;
  }

  const energy = energyAt(analysis.energy, positionMs);
  const previousEnergy = energyAt(analysis.energy, Math.max(0, positionMs - ENERGY_FLUX_MS));
  const flux = clampVisualizer((energy - previousEnergy) * 6.2);
  const accent = energyAccent(analysis.energy, positionMs);
  const beat = clampVisualizer(
    Math.max(beatEnvelope(analysis.beats, positionMs), flux * 0.92, accent * 0.85),
  );

  return {
    energy,
    bass: clampVisualizer(energy * 0.42 + accent * 0.58 + beat * 0.38 + flux * 0.46),
    mid: clampVisualizer(energy * 0.78 + beat * 0.14 + flux * 0.12),
    high: clampVisualizer(energy * 0.38 + beat * 0.36 + flux * 0.28),
    beat,
  };
}

export function shapeVisualizerFrame(
  frame: VisualizerFrame,
  sensitivityPercent: number,
): VisualizerFrame {
  const sensitivity = clampVisualizer(sensitivityPercent / 100);
  const gate = 0.06 * (1 - sensitivity);
  const gamma = 1.5 - sensitivity * 0.8;
  // Lifts small hits; the rest between hits stays near zero at any setting.
  const hit = (value: number) =>
    clampVisualizer((clampVisualizer(value) - gate) / (1 - gate)) ** gamma;

  return {
    energy: clampVisualizer(frame.energy),
    bass: hit(frame.bass),
    mid: hit(frame.mid),
    high: hit(frame.high),
    beat: hit(frame.beat),
  };
}

export function smoothVisualizerFrame(
  current: VisualizerFrame,
  target: VisualizerFrame,
  seconds: number,
): VisualizerFrame {
  const dt = Math.max(0, seconds);
  return {
    energy: smoothBand(current.energy, target.energy, dt, 0.06, 0.18),
    bass: smoothBand(current.bass, target.bass, dt, 0.012, 0.04),
    mid: smoothBand(current.mid, target.mid, dt, 0.012, 0.04),
    high: smoothBand(current.high, target.high, dt, 0.01, 0.035),
    beat: smoothBand(current.beat, target.beat, dt, 0.01, 0.035),
  };
}

/** Polled frames come in slower than the screen draws; this fills the gaps. */
export function createVisualizerFollower(): {
  push: (frame: VisualizerFrame, sensitivityPercent: number) => void;
  step: (nowMs: number) => VisualizerFrame;
} {
  let target = EMPTY_VISUALIZER_FRAME;
  let current = EMPTY_VISUALIZER_FRAME;
  let last: number | undefined;

  return {
    push(frame, sensitivityPercent) {
      target = shapeVisualizerFrame(frame, sensitivityPercent);
    },
    step(nowMs) {
      const seconds = last === undefined ? 0 : Math.min(0.1, Math.max(0, (nowMs - last) / 1_000));
      last = nowMs;
      current = smoothVisualizerFrame(current, target, seconds);
      return current;
    },
  };
}

export function hasVisualizerSignal(frame: VisualizerFrame): boolean {
  return frame.energy > 0.035 || frame.beat > 0.08 || frame.bass > 0.05;
}

export function applyVisualizerVars(
  element: HTMLElement,
  vars: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(vars)) {
    element.style.setProperty(name, value);
  }
}

export function waveVisualizerVars(
  frame: VisualizerFrame,
  metrics: LyricsAmbientMetrics,
  nowMs: number,
): Record<string, string> {
  const t = nowMs / 1_000;
  const kick = Math.max(frame.bass, frame.beat);
  const punch = visualHit(kick);
  const body = visualHit(kick * 0.84 + frame.energy * 0.1);
  const transient = punch;
  const wash = visualHit(frame.energy * 0.26 + frame.mid * 0.5 + body * 0.25);
  const restDrift = 0.14 + (1 - punch) * 0.26;
  const drift = (amount: number, speed: number, phase: number) =>
    Math.sin(t * speed + phase) * amount * restDrift;
  const bassMotion = punch;
  const midMotion = visualHit(frame.mid * 0.86 + frame.energy * 0.08);
  const highMotion = visualHit(frame.high * 0.8 + kick * 0.2);

  return {
    "--lyrics-viz-pulse-opacity": String(
      bloomOpacity(metrics.waveIdleOpacity, metrics.waveMaxOpacity, body * 0.55 + wash * 0.45),
    ),
    "--lyrics-viz-pulse-transform": transform(
      drift(1.1, 0.3, 0.4),
      drift(0.9, 0.24, 1.6),
      drift(1.6, 0.22, 0.8),
      bloomScale(metrics.waveScaleMin, metrics.waveScaleMax, 0.1, body * 0.62 + wash * 0.38),
    ),
    "--lyrics-viz-pulse-brightness": String(
      metrics.brightness * (1 + wash * 0.22 + transient * 0.18),
    ),
    "--lyrics-viz-pulse-saturation": String(
      metrics.saturation * (1 + punch * 0.28),
    ),
    "--lyrics-viz-pulse-blur": `${metrics.waveBlurPx * (1 - bassMotion * 0.22)}px`,
    "--lyrics-viz-wave-one-opacity": String(
      bloomOpacity(metrics.waveMinOpacity, metrics.waveOneMaxOpacity, bassMotion),
    ),
    "--lyrics-viz-wave-one-transform": transform(
      -3.2 + drift(1.6, 0.34, 0.3),
      1.4 + drift(1.2, 0.28, 1.9),
      -2 + drift(2.2, 0.22, 0.6),
      bloomScale(metrics.waveScaleMin, metrics.waveScaleMax, 0.16, bassMotion),
    ),
    "--lyrics-viz-wave-two-opacity": String(
      bloomOpacity(metrics.waveTwoMinOpacity, metrics.waveTwoMaxOpacity, midMotion),
    ),
    "--lyrics-viz-wave-two-transform": transform(
      2.6 + drift(1.5, 0.32, 2.2),
      -1.6 + drift(1.1, 0.26, 0.5),
      3 + drift(2, 0.24, 1.4),
      bloomScale(metrics.waveScaleMin, metrics.waveTwoScaleMax, 0.12, midMotion),
    ),
    "--lyrics-viz-ribbon-one-opacity": String(
      bloomOpacity(metrics.waveMinOpacity, metrics.waveMidOpacity, bassMotion),
    ),
    "--lyrics-viz-ribbon-one-transform":
      `translate3d(${-3 + drift(2.4, 0.36, 0.2)}%, ${-2 + drift(1.8, 0.3, 1.1)}%, 0) rotate(${-9 + drift(4.2, 0.24, 0.7)}deg) scale(${0.86 + bassMotion * 0.28}, ${0.68 + punch * 0.4})`,
    "--lyrics-viz-ribbon-two-opacity": String(
      bloomOpacity(metrics.waveMinOpacity, metrics.waveMidOpacity, midMotion),
    ),
    "--lyrics-viz-ribbon-two-transform":
      `translate3d(${3 + drift(2.2, 0.28, 2.4)}%, ${2 + drift(1.5, 0.24, 0.4)}%, 0) rotate(${7 + drift(3.6, 0.22, 1.8)}deg) scale(${0.84 + midMotion * 0.26}, ${0.7 + wash * 0.24})`,
    "--lyrics-viz-ribbon-three-opacity": String(
      bloomOpacity(metrics.waveMinOpacity * 0.6, metrics.waveMinOpacity * 1.8, highMotion),
    ),
    "--lyrics-viz-ribbon-three-transform":
      `rotate(${-2 + drift(3.2, 0.38, 1.3)}deg) scale(${0.86 + highMotion * 0.22}, ${0.64 + highMotion * 0.28})`,
  };
}

function energyAccent(
  points: VisualizerAnalysis["energy"],
  positionMs: number,
): number {
  const current = energyAt(points, positionMs);
  if (current <= 0) {
    return 0;
  }

  let weighted = 0;
  let weight = 0;
  for (const offset of [90, 180, 320, 520]) {
    const sample = energyAt(points, Math.max(0, positionMs - offset));
    const sampleWeight = 1 / offset;
    weighted += sample * sampleWeight;
    weight += sampleWeight;
  }
  const floor = weight > 0 ? weighted / weight : current;
  return clampVisualizer((current - floor) * 3.6);
}

function energyAt(
  points: VisualizerAnalysis["energy"],
  positionMs: number,
): number {
  if (points.length === 0) {
    return 0;
  }

  let low = 0;
  let high = points.length - 1;
  let index = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const point = points[mid];
    if (point && point.startMs <= positionMs) {
      index = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const point = points[index];
  if (!point || positionMs < point.startMs) {
    return 0;
  }

  const endMs = point.startMs + point.durationMs;
  if (positionMs <= endMs) {
    return clampVisualizer(point.energy);
  }

  const extra = positionMs - endMs;
  return clampVisualizer(point.energy * Math.max(0, 1 - extra / 240));
}

function beatEnvelope(
  beats: VisualizerAnalysis["beats"],
  positionMs: number,
): number {
  if (beats.length === 0) {
    return 0;
  }

  const windowStart = positionMs - BEAT_DECAY_MS;
  const windowEnd = positionMs + BEAT_ATTACK_MS;
  let low = 0;
  let high = beats.length - 1;
  let start = beats.length;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const beat = beats[mid];
    if (beat && beat.startMs >= windowStart) {
      start = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  let best = 0;
  for (let index = start; index < beats.length; index += 1) {
    const beat = beats[index];
    if (!beat || beat.startMs > windowEnd) {
      break;
    }
    const delta = positionMs - beat.startMs;
    const envelope = delta < 0
      ? (BEAT_ATTACK_MS + delta) / BEAT_ATTACK_MS
      : 1 - delta / BEAT_DECAY_MS;
    if (envelope > 0) {
      best = Math.max(best, beat.strength * envelope);
    }
  }

  return clampVisualizer(best);
}

function smoothBand(
  current: number,
  target: number,
  seconds: number,
  attack: number,
  release: number,
): number {
  const amount = 1 - Math.exp(-seconds / (target > current ? attack : release));
  return clampVisualizer(current + (target - current) * amount);
}

export function visualHit(value: number): number {
  const gated = Math.max(0, clampVisualizer(value) - 0.05) / 0.95;
  return gated ** 0.7;
}

function bloomOpacity(floor: number, peak: number, amount: number): number {
  const top = Math.min(1, Math.max(peak * 1.18, 0.34) + 0.06);
  const bottom = floor * 0.35;
  return bottom + (top - bottom) * (0.04 + clampVisualizer(amount) * 0.96);
}

function bloomScale(
  start: number,
  end: number,
  minimumTravel: number,
  amount: number,
): number {
  const travel = Math.max(end - start, minimumTravel);
  return start + travel * (0.03 + clampVisualizer(amount) * 0.97);
}

function transform(
  xPercent: number,
  yPercent: number,
  tiltDegrees: number,
  scale: number,
): string {
  return `translate3d(${xPercent}%, ${yPercent}%, 0) rotate(${tiltDegrees}deg) scale(${scale})`;
}
