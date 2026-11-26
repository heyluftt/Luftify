import { frameAroundBox } from "../../../lyrics/selfDrawnAmbient";
import { ambientAlpha, readLevels, runAmbientLoop, type PixelAmbientRef } from "./pixelAmbientState";

/** Cells across the cover; bars stand on every second one. */
const CELLS = 28;
const PEAK_HOLD_SECONDS = 0.2;
const PEAK_FALL = 26;
/** Share of the reach a bar loses per second. */
const BAR_FALL = 1.8;
const SNAKE_SPEED = 18;
const SNAKE_LENGTH = 7;

interface Bar { length: number; peak: number; hold: number }

/**
 * Pixel equalizer around the cover: block bars grow out of all four edges,
 * bass in the middle of each edge, highs towards the corners, with peak
 * blocks that hang and drop. Without music a short snake runs round the cover.
 */
export function startPixelEqualizer(canvas: HTMLCanvasElement, state: PixelAmbientRef, still: boolean): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  let bars: Bar[] = [];
  let time = 0;
  let flash = 0;
  let lastBeat = 0;

  const draw = (seconds: number, now: number) => {
    const frame = frameAroundBox(canvas, state.current.reach);
    if (!frame) return;
    const { colors, strength } = state.current;
    const cell = frame.coverWidth / CELLS;
    const rows = Math.max(4, Math.round(frame.coverHeight / cell));
    const rowCell = frame.coverHeight / rows;
    const across = CELLS / 2;
    const down = Math.floor(rows / 2);
    if (bars.length !== 2 * (across + down)) bars = Array.from({ length: 2 * (across + down) }, () => ({ length: 0, peak: 0, hold: 0 }));
    const reachCells = Math.max(3, Math.floor(frame.pad / cell));
    const gap = Math.max(1, Math.round(cell * 0.18));
    const x0 = frame.pad;
    const y0 = frame.pad;
    // outside the cover cells stay square
    const at = (i: number, j: number): [number, number] => [
      x0 + (i < CELLS ? i * cell : frame.coverWidth + (i - CELLS) * cell),
      j < 0 ? y0 + j * cell : j < rows ? y0 + j * rowCell : y0 + frame.coverHeight + (j - rows) * cell,
    ];
    const put = (i: number, j: number) => {
      const [x, y] = at(i, j);
      context.fillRect(Math.round(x), Math.round(y), Math.ceil(cell - gap), Math.ceil(cell - gap));
    };

    const levels = readLevels(state.current, now);
    time += seconds;
    context.clearRect(0, 0, frame.width, frame.height);
    const alpha = ambientAlpha(strength);

    bars.forEach((bar, index) => {
      const horizontal = index < across * 2;
      const side = horizontal ? (index < across ? 0 : 2) : (index < across * 2 + down ? 1 : 3);
      const slot = horizontal ? index % across : (index - across * 2) % down;
      const count = horizontal ? across : down;
      const u = (slot + 0.5) / count;
      const bassShare = Math.exp(-(((u - 0.5) / 0.22) ** 2));
      const highShare = Math.exp(-((Math.min(u, 1 - u) / 0.15) ** 2));
      const midShare = Math.max(0, 1 - bassShare - highShare);
      let target: number;
      if (levels.live) {
        const level = bassShare * levels.bass + midShare * levels.mid + highShare * levels.high + levels.energy * 0.18;
        const wobble = 0.74 + 0.26 * Math.sin(time * 2.3 + slot * 1.9 + side * 2.4);
        target = Math.min(1, Math.pow(level * wobble, 0.75) * 1.1) * reachCells;
      } else if (state.current.playing) {
        target = (0.5 + 0.5 * Math.sin(time * 1.3 + slot * 0.55 + side * 1.6)) * 1.4;
      } else {
        target = 0;
      }
      bar.length = target > bar.length ? target : Math.max(target, bar.length - reachCells * BAR_FALL * seconds);
      const shown = Math.round(bar.length);
      if (shown >= bar.peak) { bar.peak = shown; bar.hold = PEAK_HOLD_SECONDS; }
      else if (bar.hold > 0) bar.hold -= seconds;
      else bar.peak = Math.max(0, bar.peak - PEAK_FALL * seconds);

      const along = slot * 2 + 1;
      const cellAt = (step: number): [number, number] => side === 0 ? [along, -1 - step]
        : side === 1 ? [CELLS + step, along]
        : side === 2 ? [CELLS - 1 - along, rows + step]
        : [-1 - step, rows - 1 - along];
      for (let step = 0; step < shown; step++) {
        const share = step / reachCells;
        context.fillStyle = share < 0.45 ? colors.base : share < 0.8 ? colors.mid : colors.tip;
        context.globalAlpha = alpha * (1 - share * 0.35);
        put(...cellAt(step));
      }
      const peak = Math.ceil(bar.peak);
      if (levels.live && peak > shown) {
        context.fillStyle = colors.cap;
        context.globalAlpha = alpha;
        put(...cellAt(Math.min(peak, reachCells) - 1));
      }
    });

    // ring round the edge, clockwise
    const ringLength = 2 * (CELLS + 1) + 2 * (rows + 1);
    const ringCell = (k: number): [number, number] => {
      const n = ((k % ringLength) + ringLength) % ringLength;
      if (n < CELLS + 1) return [n - 1, -1];
      if (n < CELLS + rows + 2) return [CELLS, n - CELLS - 2];
      if (n < 2 * CELLS + rows + 3) return [CELLS - (n - CELLS - rows - 2) - 1, rows];
      return [-1, rows - (n - 2 * CELLS - rows - 3) - 1];
    };
    if (levels.beat > 0.7 && lastBeat <= 0.7) flash = 1;
    lastBeat = levels.beat;
    flash = Math.max(0, flash - seconds * 7);
    if (flash > 0) {
      context.fillStyle = colors.tip;
      context.globalAlpha = alpha * Math.ceil(flash * 3) / 3;
      for (let k = 0; k < ringLength; k++) put(...ringCell(k));
    }
    if (!levels.live) {
      const head = Math.floor((state.current.playing ? time : 0) * SNAKE_SPEED);
      context.fillStyle = colors.tip;
      for (let n = 0; n < SNAKE_LENGTH; n++) {
        context.globalAlpha = alpha * (state.current.playing ? 1 - n / SNAKE_LENGTH : 0.3);
        put(...ringCell(head - n));
      }
    }
    context.globalAlpha = 1;
  };

  return runAmbientLoop(draw, still, { box: canvas.parentElement, frameMs: 30, awake: () => state.current.playing });
}
