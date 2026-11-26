import { ambientAlpha, frameAroundBox, readAmbientLevels, runAmbientLoop } from "../../../lyrics/selfDrawnAmbient";
import { MODULAR_COLOURS, type ModularAmbientRef } from "./modularAmbientState";

const POINTS = 360;
/** superellipse, squarer than a circle */
const SHAPE = 8;
/** How much of the last frame survives: the phosphor afterglow. */
const PERSIST_FADE = 0.2;

/**
 * Oscilloscope round the cover: a phosphor ring whose wave is shaped by
 * bass, mids and highs, with a short afterglow like a tube screen.
 */
export function startScopeAmbient(canvas: HTMLCanvasElement, state: ModularAmbientRef, still: boolean): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  let time = 0;
  let punch = 0;
  let lastBeat = 0;

  const draw = (seconds: number, now: number) => {
    const { reach, strength, playing } = state.current;
    const frame = frameAroundBox(canvas, reach);
    if (!frame) return;
    const { dpr, width } = frame;
    const cx = width / 2;
    const cy = frame.height / 2;
    const halfWidth = frame.coverWidth / 2;
    const halfHeight = frame.coverHeight / 2;
    const levels = readAmbientLevels(state.current.sink, playing, now);
    if (playing) time += seconds;
    if (levels.beat > 0.32 && lastBeat <= 0.32) punch = Math.min(1, 0.5 + levels.beat);
    lastBeat = levels.beat;
    punch = Math.max(0, punch - seconds * 3.5);

    context.globalCompositeOperation = "destination-out";
    context.fillStyle = `rgb(0 0 0 / ${still ? 1 : PERSIST_FADE})`;
    context.fillRect(0, 0, width, frame.height);
    context.globalCompositeOperation = "source-over";

    const alpha = ambientAlpha(strength);
    // corners bulge in a bit
    const clearance = Math.max(halfWidth, halfHeight) * 0.09 + 8 * dpr;
    const a = halfWidth + clearance;
    const b = halfHeight + clearance;
    const room = Math.max(0, frame.pad - clearance - 6 * dpr);
    const ring = (angle: number, out: number): [number, number] => {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const x = a * Math.sign(c) * Math.abs(c) ** (2 / SHAPE);
      const y = b * Math.sign(s) * Math.abs(s) ** (2 / SHAPE);
      const length = Math.hypot(x, y) || 1;
      return [cx + x + (x / length) * out, cy + y + (y / length) * out];
    };
    const bass = levels.live ? levels.bass : playing ? 0.18 + 0.08 * Math.sin(time * 1.4) : 0.04;
    const mid = levels.live ? levels.mid : playing ? 0.1 : 0;
    const high = levels.live ? levels.high : 0;
    const amplitude = room * Math.min(1, 0.35 + punch * 0.45);

    context.strokeStyle = "rgb(233 232 225 / 9%)";
    context.lineWidth = dpr;
    context.beginPath();
    for (let tick = 0; tick < 24; tick++) {
      const angle = (tick / 24) * Math.PI * 2;
      context.moveTo(...ring(angle, -4 * dpr));
      context.lineTo(...ring(angle, 4 * dpr));
    }
    context.stroke();

    context.beginPath();
    for (let index = 0; index <= POINTS; index++) {
      const angle = (index / POINTS) * Math.PI * 2;
      const wave = bass * Math.sin(3 * angle + time * 1.7)
        + mid * 0.6 * Math.sin(7 * angle - time * 2.3)
        + high * 0.35 * Math.sin(17 * angle + time * 5.1);
      const [x, y] = ring(angle, amplitude * wave);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.globalAlpha = alpha;
    context.strokeStyle = MODULAR_COLOURS.ink;
    context.shadowColor = MODULAR_COLOURS.led;
    context.shadowBlur = (8 + punch * 10) * dpr;
    context.lineWidth = (1.6 + punch * 1.2) * dpr;
    context.stroke();
    context.shadowBlur = 0;
    context.globalAlpha = 1;
  };

  return runAmbientLoop(draw, still, { box: canvas.parentElement, awake: () => state.current.playing });
}
