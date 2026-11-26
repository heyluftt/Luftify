import type { PixelPalette } from "./pixelPalette";

const CELL = 12;
const STEP_MS = 32;

/**
 * Covers `area` and opens a pixel circle from `from` (viewport coordinates)
 * until the page lies free. The rim glows in sun and coral. Returns a
 * function that removes it early.
 */
export function pixelIris(area: DOMRect, from: { x: number; y: number }, palette: PixelPalette, steps = 9): () => void {
  const width = Math.max(1, Math.ceil(area.width));
  const height = Math.max(1, Math.ceil(area.height));
  const canvas = document.createElement("canvas");
  canvas.className = "pixelpop-dissolve";
  canvas.width = width;
  canvas.height = height;
  Object.assign(canvas.style, {
    left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px`,
  });
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;

  const ox = Math.min(width, Math.max(0, from.x - area.left));
  const oy = Math.min(height, Math.max(0, from.y - area.top));
  const columns = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const far = Math.hypot(Math.max(ox, width - ox), Math.max(oy, height - oy)) + CELL * 3;
  const distance = new Float32Array(columns * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    distance[y * columns + x] = Math.hypot(x * CELL + CELL / 2 - ox, y * CELL + CELL / 2 - oy);
  }

  let step = 0;
  const draw = () => {
    const radius = far * Math.pow(step / steps, 1.3);
    context.clearRect(0, 0, width, height);
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const d = distance[y * columns + x]!;
      if (d < radius) continue;
      context.fillStyle = d < radius + CELL ? palette.sun : d < radius + CELL * 2 ? palette.coral : palette.deep;
      context.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  };
  draw();
  document.body.appendChild(canvas);

  let timer = 0;
  const next = () => {
    step += 1;
    if (step > steps) { canvas.remove(); return; }
    draw();
    timer = window.setTimeout(next, STEP_MS);
  };
  timer = window.setTimeout(next, STEP_MS);
  return () => {
    window.clearTimeout(timer);
    canvas.remove();
  };
}
