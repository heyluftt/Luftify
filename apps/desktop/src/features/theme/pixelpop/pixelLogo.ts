import type { PixelPalette } from "./pixelPalette";

const GLYPHS: Record<string, string[]> = {
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
};
const WORD = "LUFTIFY";
const CELL = 12;
/** Room above the letters for the pixels to fall through. */
const DROP = 9;
const FRAME_MS = 40;

interface Pixel { x: number; y: number; at: number; fall: number; speed: number; gone: boolean }

/** „LUFTIFY“ falls in pixel by pixel; `clear` takes it apart again. */
export function startPixelLogo(canvas: HTMLCanvasElement, palette: PixelPalette) {
  const context = canvas.getContext("2d");
  const pixels: Pixel[] = [];
  let column = 0;
  for (const letter of WORD) {
    const glyph = GLYPHS[letter]!;
    glyph.forEach((line, y) => [...line].forEach((bit, x) => {
      if (bit !== "1") return;
      const at = (column + x) * 24 + Math.random() * 180;
      pixels.push({ x: column + x, y, at, fall: -2 - Math.random() * 8, speed: 0, gone: false });
    }));
    column += glyph[0]!.length + 1;
  }
  const columns = column - 1;
  canvas.width = (columns + 1) * CELL;
  canvas.height = (DROP + 8) * CELL;
  let elapsed = 0;
  let timer = 0;
  let settled = false;

  const draw = (time: number) => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    let moving = false;
    for (const pixel of pixels) {
      if (pixel.gone) continue;
      if (time < pixel.at) { moving = true; continue; }
      const target = DROP + pixel.y;
      if (pixel.fall < target) {
        pixel.speed += 0.6;
        pixel.fall = Math.min(target, pixel.fall + pixel.speed);
        moving = true;
      }
      const y = Math.round(pixel.fall) * CELL;
      context.fillStyle = palette.plum;
      context.fillRect(pixel.x * CELL + 4, y + 4, CELL - 2, CELL - 2);
      context.fillStyle = pixel.y < 2 ? palette.sun : palette.coral;
      context.fillRect(pixel.x * CELL, y, CELL - 2, CELL - 2);
    }
    if (!moving && !settled) {
      settled = true;
      context.fillStyle = palette.cream;
      context.fillRect(0, (DROP + 8) * CELL - 4, (columns + 1) * CELL - 2, 4);
    }
    return moving;
  };

  // timers, rAF stalls during the start
  const tick = () => {
    elapsed += FRAME_MS;
    if (draw(elapsed) || !settled) timer = window.setTimeout(tick, FRAME_MS);
  };
  timer = window.setTimeout(tick, FRAME_MS);

  return {
    stop: () => window.clearTimeout(timer),
    clear: () => new Promise<void>((resolve) => {
      window.clearTimeout(timer);
      const left = pixels.filter((pixel) => !pixel.gone).sort(() => Math.random() - 0.5);
      const perStep = Math.max(1, Math.ceil(left.length / 8));
      settled = true;
      const step = () => {
        left.splice(0, perStep).forEach((pixel) => { pixel.gone = true; pixel.fall = DROP + pixel.y; });
        context?.clearRect(0, 0, canvas.width, canvas.height);
        draw(Number.POSITIVE_INFINITY);
        if (left.length) timer = window.setTimeout(step, 36);
        else resolve();
      };
      step();
    }),
  };
}
