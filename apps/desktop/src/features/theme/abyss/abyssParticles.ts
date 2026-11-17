/**
 * Plankton and marine snow for the Tiefsee scene, drawn on one canvas.
 * Each particle drifts on its own in a slow current, at one of several
 * depths; the beat makes a few of them flare, the pointer lights up and
 * pushes away the ones near it. About 30 frames a second, nothing while
 * the window is hidden, minimised or the scene is gone.
 */
import { abyssLevels } from "./useAbyssPulse";
import { prefersLessMotion } from "../../motion/motionLevel";

const COLORS: Array<[number, number, number]> = [
  [92, 232, 218], [120, 245, 236], [150, 190, 255], [228, 107, 255],
];
const SNOW: [number, number, number] = [214, 240, 238];
const FRAME_MS = 33;
const POINTER_RADIUS = 150;
/** Frames this far apart on average mean the machine is struggling. */
const STRUGGLING_MS = 48;

interface Particle {
  x: number; y: number;
  /** Depth 0.25 (far, small, slow) to 1 (near). */
  z: number;
  size: number;
  color: number;
  phase: number;
  twinkle: number;
  /** A flare from the beat or the pointer, decaying to 0. */
  flare: number;
  snow: boolean;
}

/** A soft glow per colour, drawn once and stamped for every particle. */
function sprite(rgb: [number, number, number]): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.12, `rgba(${rgb.join(",")},0.95)`);
  gradient.addColorStop(0.35, `rgba(${rgb.join(",")},0.32)`);
  gradient.addColorStop(1, `rgba(${rgb.join(",")},0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return canvas;
}

export function startAbyssParticles(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return () => undefined;
  const sprites = COLORS.map(sprite);
  const snowSprite = sprite(SNOW);
  const reduced = prefersLessMotion();
  let width = 0;
  let height = 0;
  let particles: Particle[] = [];
  let frame = 0;
  let last = 0;
  let time = 0;
  let lastBurst = 0;
  const pointer = { x: -9999, y: -9999, active: false };

  const seed = (snow: boolean): Particle => {
    const z = 0.25 + Math.random() * 0.75;
    return {
      x: Math.random() * width,
      // Plankton gathers in the depths, below the light.
      y: snow ? Math.random() * height : height * (0.15 + Math.pow(Math.random(), 0.75) * 0.85),
      z,
      size: snow ? 0.6 + z * 0.9 : 0.5 + z * 1.6,
      color: Math.random() < 0.18 ? 3 : Math.floor(Math.random() * 3),
      phase: Math.random() * Math.PI * 2,
      twinkle: 0.6 + Math.random() * 1.8,
      flare: 0,
      snow,
    };
  };

  // Soft glows gain nothing from a sharper canvas, so one canvas pixel per CSS pixel.
  let lite = false;
  const resize = () => {
    const ratio = 1;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const plankton = Math.round(Math.min(lite ? 130 : 260, Math.max(lite ? 60 : 120, (width * height) / (lite ? 14000 : 7000))));
    particles = [
      ...Array.from({ length: plankton }, () => seed(false)),
      ...Array.from({ length: Math.round(plankton / 6) }, () => seed(true)),
    ];
  };

  const step = (seconds: number) => {
    time += seconds;
    const { pulse, energy } = abyssLevels;
    // On a strong beat, a handful of plankton lights up at once.
    if (pulse > 0.55 && time - lastBurst > 0.28) {
      lastBurst = time;
      for (let i = 0; i < 4 + Math.round(pulse * 6); i++) {
        const particle = particles[Math.floor(Math.random() * particles.length)];
        if (particle && !particle.snow) particle.flare = Math.min(1, particle.flare + 0.7 + pulse * 0.3);
      }
    }
    for (const p of particles) {
      if (p.snow) {
        p.y += (5 + p.z * 9) * seconds;
        p.x += Math.sin(time * 0.6 + p.phase) * 4 * seconds;
      } else {
        // A slow current: mostly sideways, gently lifting, curling with depth.
        p.x += (4 + Math.sin(p.y * 0.004 + time * 0.12) * 7) * p.z * seconds;
        p.y += (-2.2 + Math.cos(p.x * 0.003 + time * 0.09) * 3) * p.z * seconds;
      }
      if (pointer.active) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < POINTER_RADIUS && distance > 0.1) {
          const force = (1 - distance / POINTER_RADIUS);
          p.x += (dx / distance) * force * 26 * seconds;
          p.y += (dy / distance) * force * 26 * seconds;
          if (!p.snow) p.flare = Math.max(p.flare, force * 0.85);
        }
      }
      p.flare *= Math.exp(-seconds * 1.6);
      if (p.x > width + 20) p.x = -20;
      if (p.x < -20) p.x = width + 20;
      if (p.y < -20) p.y = height + 20;
      if (p.y > height + 20) p.y = p.snow ? -20 : height * 0.2;
    }
    return 0.78 + energy * 0.32;
  };

  const draw = (brightness: number) => {
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    for (const p of particles) {
      const twinkle = 0.55 + 0.45 * Math.sin(time * p.twinkle + p.phase);
      const alpha = Math.min(1, (p.snow ? 0.22 : 0.28 + p.z * 0.42) * twinkle * brightness + p.flare * 0.9);
      if (alpha < 0.02) continue;
      const radius = p.size * (p.snow ? 3 : 4 + p.flare * 7);
      context.globalAlpha = alpha;
      context.drawImage(p.snow ? snowSprite : sprites[p.color]!, p.x - radius, p.y - radius, radius * 2, radius * 2);
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  };

  const idle = () => document.hidden || document.documentElement.hasAttribute("data-window-idle");
  // If frames keep arriving late, the scene switches to a lighter version
  // once: half the plankton here, fewer distant details in CSS (data-lite).
  let slowFrames = 0;
  let measuredFrames = 0;
  const watch = (interval: number) => {
    if (lite || measuredFrames > 400) return;
    // Long gaps come from a covered or background window, not a slow machine.
    if (interval > 200) return;
    measuredFrames++;
    if (interval > STRUGGLING_MS) slowFrames++;
    if (measuredFrames >= 90 && slowFrames / measuredFrames > 0.5) {
      lite = true;
      canvas.closest(".abyss-scene")?.setAttribute("data-lite", "");
      resize();
    }
  };
  const loop = (now: number) => {
    frame = window.requestAnimationFrame(loop);
    if (idle()) { last = now; return; }
    if (now - last < FRAME_MS) return;
    const interval = now - (last || now);
    const seconds = Math.min(0.1, interval / 1000);
    last = now;
    watch(interval);
    draw(step(seconds));
  };

  const observer = new ResizeObserver(() => { resize(); if (reduced) draw(1); });
  observer.observe(canvas);
  resize();
  const onPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
  };
  const onLeave = () => { pointer.active = false; };
  if (reduced) {
    draw(1);
  } else {
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    frame = window.requestAnimationFrame(loop);
  }
  return () => {
    window.cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("pointermove", onPointer);
    document.removeEventListener("pointerleave", onLeave);
  };
}
