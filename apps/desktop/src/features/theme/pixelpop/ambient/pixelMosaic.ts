import { frameAroundBox } from "../../../lyrics/selfDrawnAmbient";
import { ambientAlpha, readLevels, runAmbientLoop, type PixelAmbientRef } from "./pixelAmbientState";

/** Tiles across the cover; the cover is sampled at this size. */
export const MOSAIC_TILES = 12;
/** 4 × 4 ordered dither, so the mosaic thins out like an old screen. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((value) => (value + 0.5) / 16);
const SPARKLE_SECONDS = 0.09;
const tileKey = (i: number, j: number) => (j + 512) * 1024 + i + 512;

interface Wave { radius: number; strength: number }

/** lifts near-black tiles, dark covers vanish otherwise */
function brighten(rgb: number[], toward: number[]): number[] {
  const light = 0.3 * rgb[0]! + 0.59 * rgb[1]! + 0.11 * rgb[2]!;
  const share = Math.max(0, (70 - light) / 70) * 0.85;
  return rgb.map((value, index) => value + (toward[index]! - value) * share);
}

/** "#rrggbb" or "rgb(r g b)". */
function toRgb(color: string): [number, number, number] {
  const hex = /^#([\da-f]{6})$/i.exec(color.trim());
  if (hex) {
    const value = Number.parseInt(hex[1]!, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const parts = color.match(/[\d.]+/g)?.map(Number);
  return parts && parts.length >= 3 ? [parts[0]!, parts[1]!, parts[2]!] : [120, 110, 160];
}

/**
 * The cover spills past its edges as a coarse mosaic that thins out in a
 * dither. Every beat sends a wave of light outwards; highs make single
 * tiles flash.
 */
export function startPixelMosaic(canvas: HTMLCanvasElement, state: PixelAmbientRef, still: boolean): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  const waves: Wave[] = [];
  const sparkles = new Map<number, number>();
  let time = 0;
  let lastBeat = 0;
  let idleWave = 0;

  const draw = (seconds: number, now: number) => {
    const { cover, colors, strength, reach, playing } = state.current;
    const frame = frameAroundBox(canvas, reach);
    if (!frame) return;
    const columns = MOSAIC_TILES;
    const tile = frame.coverWidth / columns;
    // tall video: more rows, cover stretched
    const rows = Math.max(columns, Math.round(frame.coverHeight / tile));
    const rowTile = frame.coverHeight / rows;
    const reachTiles = Math.max(2, Math.floor(frame.pad / tile));
    const gap = Math.max(1, Math.round(tile * 0.1));
    const x0 = frame.pad;
    const y0 = frame.pad;
    const levels = readLevels(state.current, now);
    time += seconds;

    const breath = 0.5 + 0.5 * Math.sin(time * 0.8);
    const radius = reachTiles * (levels.live
      ? 0.5 + 0.18 * breath + 0.5 * levels.bass
      : playing ? 0.55 + 0.25 * breath : 0.45);

    if (levels.live && levels.beat > 0.55 && lastBeat <= 0.55) waves.push({ radius: 0, strength: Math.min(1, levels.beat) });
    lastBeat = levels.beat;
    if (!levels.live && playing && (idleWave -= seconds) <= 0) {
      idleWave = 2.4;
      waves.push({ radius: 0, strength: 0.35 });
    }
    for (const wave of waves) wave.radius += reachTiles * 3 * seconds;
    while (waves.length && waves[0]!.radius > reachTiles + 2) waves.shift();

    if (levels.live && Math.random() < levels.high * 0.6) {
      const i = Math.floor(Math.random() * (columns + 2 * reachTiles)) - reachTiles;
      const j = Math.floor(Math.random() * (rows + 2 * reachTiles)) - reachTiles;
      sparkles.set(tileKey(i, j), SPARKLE_SECONDS);
    }
    for (const [key, left] of sparkles) {
      if (left - seconds <= 0) sparkles.delete(key);
      else sparkles.set(key, left - seconds);
    }

    context.clearRect(0, 0, frame.width, frame.height);
    context.globalAlpha = ambientAlpha(strength);
    const fallback = toRgb(colors.base);
    const cream = toRgb(colors.cap);
    for (let j = -reachTiles; j < rows + reachTiles; j++) {
      for (let i = -reachTiles; i < columns + reachTiles; i++) {
        const dx = i < 0 ? -i : i >= columns ? i - columns + 1 : 0;
        const dy = j < 0 ? -j : j >= rows ? j - rows + 1 : 0;
        if (dx === 0 && dy === 0) continue;
        const distance = Math.hypot(dx, dy);
        let lift = 0;
        for (const wave of waves) lift = Math.max(lift, (1 - Math.abs(distance - wave.radius)) * wave.strength);
        const fade = 1 - (distance - 1) / Math.max(1, radius);
        const threshold = BAYER[(((i % 4) + 4) % 4) * 4 + (((j % 4) + 4) % 4)]!;
        const sparkle = sparkles.has(tileKey(i, j));
        if (fade + lift * 0.7 <= threshold && !sparkle) continue;

        const si = Math.min(MOSAIC_TILES - 1, Math.max(0, i));
        const sj = Math.min(MOSAIC_TILES - 1, Math.max(0, Math.floor((Math.min(rows - 1, Math.max(0, j)) * MOSAIC_TILES) / rows)));
        const at = (sj * MOSAIC_TILES + si) * 4;
        const rgb = cover ? brighten([cover[at]!, cover[at + 1]!, cover[at + 2]!], fallback) : fallback;
        const shade = Math.min(1.15, 0.62 - 0.32 * (distance / (reachTiles + 1)) + lift * 0.55);
        const [r, g, b] = sparkle ? cream : rgb.map((value) => Math.round(Math.min(255, value * shade + lift * 60)));
        context.fillStyle = `rgb(${r} ${g} ${b})`;
        const x = x0 + (i < columns ? i * tile : frame.coverWidth + (i - columns) * tile);
        const y = j < 0 ? y0 + j * tile : j < rows ? y0 + j * rowTile : y0 + frame.coverHeight + (j - rows) * tile;
        context.fillRect(Math.round(x), Math.round(y), Math.ceil(tile - gap), Math.ceil(tile - gap));
      }
    }
    context.globalAlpha = 1;
  };

  return runAmbientLoop(draw, still, { box: canvas.parentElement, frameMs: 30, awake: () => state.current.playing });
}
