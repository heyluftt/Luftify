import type { VisualizerFrameSink } from "./useAmbientVisualizer";

/** For theme ambients that draw on their own canvas instead of CSS variables. */
export interface AmbientLevels {
  live: boolean;
  energy: number;
  bass: number;
  mid: number;
  high: number;
  beat: number;
}

/** Frames older than this mean the visualizer went quiet. */
const STALE_MS = 300;

export function readAmbientLevels(sink: VisualizerFrameSink, playing: boolean, now: number): AmbientLevels {
  const sample = sink.current;
  if (!playing || !sample || now - sample.at > STALE_MS) {
    return { live: false, energy: 0, bass: 0, mid: 0, high: 0, beat: 0 };
  }
  return { live: true, ...sample.frame };
}

/** Colour strength 0 to 2 as canvas opacity. */
export function ambientAlpha(strength: number): number {
  return Math.min(1, Math.max(0.3, 0.35 + strength * 0.42));
}

/** paused this long = picture settled, stop drawing */
const REST_AFTER_SECONDS = 2;

export interface AmbientLoopOptions {
  /** redraw on resize while resting */
  box?: Element | null;
  /** min ms between frames */
  frameMs?: number;
  /** false while paused */
  awake?: () => boolean;
}

/** draw loop for the canvas ambients; with `still` just one frame */
export function runAmbientLoop(
  draw: (seconds: number, now: number) => void,
  still: boolean,
  { box, frameMs = 0, awake }: AmbientLoopOptions = {},
): () => void {
  let frame = 0;
  let last = 0;
  let quiet = 0;
  let resting = still;
  const once = () => draw(0, performance.now());
  const observer = box ? new ResizeObserver(() => { if (resting) once(); }) : undefined;
  if (box) observer?.observe(box);
  if (still) {
    once();
    return () => observer?.disconnect();
  }
  const loop = (now: number) => {
    frame = window.requestAnimationFrame(loop);
    if (document.hidden || document.documentElement.hasAttribute("data-window-idle")) { last = now; return; }
    if (last && now - last < frameMs) return;
    const seconds = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    quiet = awake && !awake() ? quiet + seconds : 0;
    resting = quiet > REST_AFTER_SECONDS;
    if (!resting) draw(seconds, now);
  };
  frame = window.requestAnimationFrame(loop);
  return () => {
    window.cancelAnimationFrame(frame);
    observer?.disconnect();
  };
}

/** all in device px */
export interface AmbientFrame {
  dpr: number;
  width: number;
  height: number;
  pad: number;
  coverWidth: number;
  coverHeight: number;
}

/** canvas round the cover or a tall video, margin = reach × shorter side */
export function frameAroundBox(canvas: HTMLCanvasElement, reach: number): AmbientFrame | undefined {
  const box = canvas.parentElement;
  const boxWidth = box?.clientWidth ?? 0;
  const boxHeight = box?.clientHeight ?? 0;
  if (boxWidth === 0 || boxHeight === 0) return undefined;
  const room = Math.round(reach * Math.min(boxWidth, boxHeight));
  const style = `${-room}px|${boxWidth + 2 * room}px|${boxHeight + 2 * room}px`;
  if (canvas.dataset.frame !== style) {
    canvas.dataset.frame = style;
    canvas.style.left = `${-room}px`;
    canvas.style.top = `${-room}px`;
    canvas.style.width = `${boxWidth + 2 * room}px`;
    canvas.style.height = `${boxHeight + 2 * room}px`;
  }
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round((boxWidth + 2 * room) * dpr);
  const height = Math.round((boxHeight + 2 * room) * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { dpr, width, height, pad: room * dpr, coverWidth: boxWidth * dpr, coverHeight: boxHeight * dpr };
}
