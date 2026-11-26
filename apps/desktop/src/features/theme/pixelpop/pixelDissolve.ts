import type { PixelPalette } from "./pixelPalette";

const STEP_MS = 30;
const BLOCK = 48;

/** block wipe over the window, clears top to bottom */
export function pixelReveal(palette: PixelPalette, steps: number): () => void {
  const columns = Math.max(1, Math.ceil(window.innerWidth / BLOCK));
  const rows = Math.max(1, Math.ceil(window.innerHeight / BLOCK));
  const canvas = document.createElement("canvas");
  canvas.className = "pixelpop-dissolve is-window";
  canvas.width = columns;
  canvas.height = rows;
  Object.assign(canvas.style, { left: "0", top: "0", width: `${window.innerWidth}px`, height: `${window.innerHeight}px` });
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  const tones = [palette.deep, palette.deep, palette.panel, palette.deep, palette.panel2, palette.deep, palette.panel, palette.coral, palette.deep, palette.line, palette.sun];
  for (let cell = 0; cell < columns * rows; cell++) {
    context.fillStyle = tones[(cell * 7 + Math.floor(Math.random() * 3)) % tones.length]!;
    context.fillRect(cell % columns, Math.floor(cell / columns), 1, 1);
  }
  document.body.appendChild(canvas);

  const cells = Array.from({ length: columns * rows }, (_, index) => index);
  const key = cells.map((cell) => Math.floor(cell / columns) + Math.random() * 2.5);
  const order = cells.sort((a, b) => key[a]! - key[b]!);
  const perStep = Math.ceil(order.length / steps);
  let done = 0;
  let timer = 0;
  const clear = () => {
    for (let k = 0; k < perStep && done < order.length; k++, done++) {
      const cell = order[done]!;
      context.clearRect(cell % columns, Math.floor(cell / columns), 1, 1);
    }
    if (done < order.length) timer = window.setTimeout(clear, STEP_MS);
    else canvas.remove();
  };
  timer = window.setTimeout(clear, STEP_MS);
  return () => {
    window.clearTimeout(timer);
    canvas.remove();
  };
}
