import { prefersLessMotion } from "../../motion/motionLevel";
import { readPixelPalette, type PixelPalette } from "./pixelPalette";
import { pixelLevels } from "./usePixelPulse";

/** Pixel night behind the content; houses hop to the bass, windows flicker with the highs. */

const SCALE = 4;
const FRAME_MS = 50;
const CITY_ROWS = 30;
/** The city builds up in this many steps when the scene starts. */
const GROW_STEPS = 6;
const GROW_SECONDS = 0.6;

interface House { x: number; w: number; h: number; hop: number; tone: number; phase: number }
interface Star { x: number; y: number; phase: number; speed: number }
interface Meteor { x: number; y: number; age: number }

/** Seeded, so the city keeps its shape when the window is resized. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function disc(context: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y <= r * r + r * 0.6) context.fillRect(cx + x, cy + y, 1, 1);
  }
}

export function startPixelSky(canvas: HTMLCanvasElement, host: HTMLElement): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  let palette: PixelPalette | undefined;
  let width = 0;
  let height = 0;
  let houses: House[] = [];
  let stars: Star[] = [];
  let meteor: Meteor | undefined;
  let nextMeteor = 9 + Math.random() * 12;
  let time = 0;
  let frame = 0;
  let last = 0;
  let grow = prefersLessMotion() ? 1 : 0;

  const build = () => {
    width = Math.max(1, Math.ceil(host.clientWidth / SCALE));
    height = Math.max(1, Math.ceil(host.clientHeight / SCALE));
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width * SCALE}px`;
    canvas.style.height = `${height * SCALE}px`;
    const random = seeded(1984);
    houses = [];
    for (let x = 0; x < width;) {
      const w = 3 + Math.floor(random() * 6);
      houses.push({ x, w, h: 4 + Math.floor(random() * 15), hop: 1 + Math.floor(random() * 6), tone: Math.floor(random() * 3), phase: random() * 6.3 });
      x += w + (random() < 0.3 ? 1 : 0);
    }
    const sky = Math.max(1, height - CITY_ROWS);
    stars = Array.from({ length: Math.round((width * sky) / 150) }, () => ({
      x: Math.floor(random() * width), y: Math.floor(random() * sky), phase: random() * 6.3, speed: 0.5 + random() * 1.5,
    }));
  };

  const draw = () => {
    palette ??= readPixelPalette(canvas);
    const p = palette;
    const { bass, high, beat } = pixelLevels;
    context.clearRect(0, 0, width, height);
    const built = Math.ceil(Math.min(1, grow) * GROW_STEPS) / GROW_STEPS;

    for (const star of stars) {
      if (star.phase / 6.3 > built) continue;
      const glow = Math.sin(time * star.speed + star.phase);
      if (glow < 0.3) continue;
      context.fillStyle = glow > 0.92 ? p.cream : p.line;
      context.fillRect(star.x, star.y, 1, 1);
    }

    const moonX = width - 24;
    context.fillStyle = p.cream;
    disc(context, moonX, 11, 5);
    context.fillStyle = p.ink;
    disc(context, moonX + 3, 9, 4);

    if (meteor) {
      const tail = [p.cream, p.cream, p.mute, p.line, p.line];
      tail.forEach((color, index) => {
        context.fillStyle = color;
        context.fillRect(Math.round(meteor!.x + index * 2), Math.round(meteor!.y - index), 1, 1);
      });
    }

    const tones = [p.panel, p.panel2, p.panel];
    houses.forEach((house, index) => {
      const lift = Math.round(house.hop * bass * (0.55 + 0.45 * Math.sin(index * 1.7 + house.phase)));
      const tall = Math.round(house.h * built);
      if (tall < 1) return;
      const top = height - tall - lift;
      context.fillStyle = tones[house.tone]!;
      context.fillRect(house.x, top, house.w, tall + lift);
      context.fillStyle = p.sun;
      for (let y = top + 2; y < height - 1; y += 3) {
        for (let x = house.x + 1; x < house.x + house.w - 1; x += 2) {
          const lit = ((x * 7 + y * 13 + index * 5) % 17) / 17;
          if (lit < 0.2 + high * 0.28 || (lit > 0.95 && Math.sin(time * 2 + index) > 0.4)) context.fillRect(x, y, 1, 1);
        }
      }
      if (lift > 1) {
        context.fillStyle = beat > 0.6 ? p.coral : p.sun;
        context.fillRect(house.x, top, house.w, 1);
      }
    });
  };

  const advance = (seconds: number) => {
    time += seconds;
    grow += seconds / GROW_SECONDS;
    if (meteor) {
      meteor.x -= 2;
      meteor.y += 1;
      meteor.age += 1;
      if (meteor.age > 26 || meteor.x < 0) meteor = undefined;
    } else if ((nextMeteor -= seconds) <= 0) {
      nextMeteor = 14 + Math.random() * 18;
      meteor = { x: width * (0.3 + Math.random() * 0.6), y: Math.random() * 8, age: 0 };
    }
  };

  const idle = () => document.hidden || document.documentElement.hasAttribute("data-window-idle");
  const loop = (now: number) => {
    frame = window.requestAnimationFrame(loop);
    if (idle()) { last = now; return; }
    if (now - last < FRAME_MS) return;
    const seconds = Math.min(0.2, (now - (last || now)) / 1000);
    last = now;
    advance(seconds);
    draw();
  };

  const still = prefersLessMotion();
  const observer = new ResizeObserver(() => { build(); draw(); });
  observer.observe(host);
  build();
  draw();
  if (!still) frame = window.requestAnimationFrame(loop);
  return () => {
    window.cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
