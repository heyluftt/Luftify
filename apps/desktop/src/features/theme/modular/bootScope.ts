import { t } from "../../../i18n";

const FRAME_MS = 33;
const WORD = "LUFTIFY";

/**
 * An oscilloscope in the empty content frame during the start: the trace
 * finds its signal while „LUFTIFY“ types itself above it. Timers instead of
 * animation frames: the browser holds frames back during the start.
 */
export function startBootScope(canvas: HTMLCanvasElement, colours: { led: string; ink: string; mute: string }) {
  const context = canvas.getContext("2d");
  let time = 0;
  let timer = 0;

  const draw = () => {
    if (!context) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const mid = height * 0.62;

    context.strokeStyle = "rgb(233 232 225 / 6%)";
    context.lineWidth = 1;
    for (let x = 0; x <= width; x += width / 10) { context.beginPath(); context.moveTo(x, mid - 46); context.lineTo(x, mid + 46); context.stroke(); }
    context.beginPath(); context.moveTo(0, mid); context.lineTo(width, mid); context.stroke();

    const found = Math.min(1, time / 1.4);
    const noise = 1 - found;
    context.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const u = x / width;
      const fade = Math.sin(Math.PI * u);
      const wave = Math.sin(u * Math.PI * 6 + time * 5) * 30 * found * fade;
      const jitter = (Math.random() - 0.5) * 18 * noise * fade;
      const y = mid + wave + jitter;
      if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.strokeStyle = colours.ink;
    context.shadowColor = colours.led;
    context.shadowBlur = 8;
    context.lineWidth = 1.8;
    context.stroke();
    context.shadowBlur = 0;

    const typed = WORD.slice(0, Math.floor(time / 0.12));
    context.fillStyle = colours.ink;
    context.font = "500 26px 'Martian Mono', monospace";
    context.textAlign = "center";
    context.fillText(typed.padEnd(WORD.length, " "), width / 2, height * 0.22);
    context.fillStyle = colours.mute;
    context.font = "600 11px 'Barlow Condensed', sans-serif";
    context.fillText(t(found < 1 ? "modular.signalSearch" : "modular.signalFound"), width / 2, height * 0.22 + 22);
  };

  const tick = () => {
    if (!document.documentElement.hasAttribute("data-window-idle")) {
      time += FRAME_MS / 1000;
      draw();
    }
    timer = window.setTimeout(tick, FRAME_MS);
  };
  timer = window.setTimeout(tick, FRAME_MS);
  return () => window.clearTimeout(timer);
}
