/**
 * Wind for the Aeris scene: thin streaks on one canvas. Each streak follows
 * a slowly turning flow field and leaves a fading trail. Now and then a gust
 * sweeps in from the left: streaks near its front speed up, stretch and
 * brighten. The wind parts around the pointer. About 30 frames a second,
 * nothing while the window is hidden, minimised or the scene is gone.
 */

const FRAME_MS = 33;
const POINTER_RADIUS = 170;
/** Frames this far apart on average mean the machine is struggling. */
const STRUGGLING_MS = 48;
const TRAIL = 40;
/** A few long, faint threads among the short streaks. */
const LONG_TRAIL = 80;

interface Streak {
  xs: Float32Array;
  ys: Float32Array;
  head: number;
  count: number;
  /** Depth 0.3 (far, thin, slow) to 1 (near). */
  z: number;
  long: boolean;
  age: number;
  life: number;
  /** How strongly the gust currently carries it, 0 to about 1.7. */
  gust: number;
}

interface Gust { x: number; speed: number; strength: number; next: number }

/**
 * Direction of the wind at a point: mostly to the right and lifting a
 * little, in long waves that travel with it, so neighbouring streaks swing
 * together like layers of air.
 */
function flow(x: number, y: number, time: number): number {
  return -0.06
    + 0.3 * Math.sin(x * 0.0045 - time * 0.12 + Math.sin(y * 0.004) * 1.5)
    + 0.12 * Math.sin(y * 0.011 - time * 0.08);
}

export function startAerisWind(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return () => undefined;
  // The theme's stylesheet loads on selection, so the colour is read once it is there.
  let color = "";
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  let width = 0;
  let height = 0;
  let streaks: Streak[] = [];
  let frame = 0;
  let last = 0;
  let time = 0;
  let lite = false;
  const gust: Gust = { x: -9999, speed: 0, strength: 0, next: 4 };
  const pointer = { x: -9999, y: -9999, active: false };

  const place = (streak: Streak, fresh: boolean) => {
    // New streaks appear anywhere and fade in, so the left edge never looks like a nozzle.
    streak.xs[0] = -40 + Math.random() * (width + 40);
    streak.ys[0] = Math.random() * height;
    streak.head = 0;
    streak.count = 1;
    streak.life = 4 + Math.random() * 6;
    streak.age = fresh ? Math.random() * streak.life : 0;
  };

  const create = (): Streak => {
    const long = Math.random() < 0.08;
    const length = long ? LONG_TRAIL : TRAIL;
    const streak: Streak = {
      xs: new Float32Array(length), ys: new Float32Array(length), head: 0, count: 0,
      z: 0.3 + Math.random() * 0.7, long, age: 0, life: 1, gust: 0,
    };
    place(streak, true);
    return streak;
  };

  const gustAt = (x: number, y: number) => {
    if (gust.strength === 0) return 0;
    // A slanted front, wider at the top, so it never reads as a straight wipe.
    const distance = (x - gust.x + (y - height / 2) * 0.35) / 260;
    return gust.strength * Math.exp(-distance * distance);
  };

  const step = (seconds: number) => {
    time += seconds;
    if (time > gust.next) {
      gust.x = -420;
      gust.speed = 280 + Math.random() * 160;
      gust.strength = 0.8 + Math.random() * 0.9;
      gust.next = time + (width + 900) / gust.speed + 8 + Math.random() * 10;
    }
    if (gust.strength > 0) {
      gust.x += gust.speed * seconds;
      if (gust.x > width + 480) gust.strength = 0;
    }
    for (const streak of streaks) {
      const index = streak.head;
      const x = streak.xs[index]!;
      const y = streak.ys[index]!;
      const carried = gustAt(x, y);
      streak.gust = carried;
      const direction = flow(x, y, time) - carried * 0.08;
      const speed = (60 + 80 * streak.z) * (1 + carried * 1.6);
      let vx = Math.cos(direction) * speed;
      let vy = Math.sin(direction) * speed;
      if (pointer.active) {
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < POINTER_RADIUS && distance > 0.1) {
          const force = (1 - distance / POINTER_RADIUS) ** 2 * 130;
          vx += (dx / distance) * force;
          vy += (dy / distance) * force;
        }
      }
      const next = (index + 1) % streak.xs.length;
      streak.xs[next] = x + vx * seconds;
      streak.ys[next] = y + vy * seconds;
      streak.head = next;
      streak.count = Math.min(streak.xs.length, streak.count + 1);
      streak.age += seconds;
      const nx = streak.xs[next]!;
      const ny = streak.ys[next]!;
      if (streak.age > streak.life || nx > width + 80 || ny < -80 || ny > height + 80) place(streak, false);
    }
  };

  /** Each trail in three pieces, fainter towards its tail. */
  const draw = () => {
    context.clearRect(0, 0, width, height);
    color ||= getComputedStyle(canvas).getPropertyValue("--aeris-paper").trim();
    if (!color) return;
    context.strokeStyle = color;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const streak of streaks) {
      if (streak.count < 3) continue;
      const fade = Math.min(1, streak.age / 1.2, (streak.life - streak.age) / 1.6);
      const base = Math.min(0.85, (streak.long ? 0.08 + streak.z * 0.1 : 0.1 + streak.z * 0.22) * fade * (1 + streak.gust * 0.9));
      if (base < 0.02) continue;
      const length = streak.xs.length;
      const start = streak.head - streak.count + 1 + length;
      const piece = Math.ceil((streak.count - 1) / 3);
      for (let part = 0; part < 3; part++) {
        const from = part * piece;
        const to = Math.min(streak.count - 1, from + piece);
        if (to <= from) continue;
        context.globalAlpha = base * (0.22 + part * 0.39);
        context.lineWidth = (0.4 + streak.z * 0.6) * (streak.long ? 1.6 : 1) * (0.7 + part * 0.2);
        context.beginPath();
        for (let i = from; i <= to; i++) {
          const point = (start + i) % length;
          if (i === from) context.moveTo(streak.xs[point]!, streak.ys[point]!);
          else context.lineTo(streak.xs[point]!, streak.ys[point]!);
        }
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  };

  // Thin lines gain little from a sharper canvas, so one canvas pixel per CSS pixel.
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const count = Math.round(Math.min(lite ? 70 : 150, Math.max(lite ? 35 : 60, (width * height) / (lite ? 18000 : 9000))));
    streaks = Array.from({ length: count }, create);
    // Start with the trails already drawn out.
    for (let i = 0; i < TRAIL; i++) step(1 / 30);
  };

  const idle = () => document.hidden || document.documentElement.hasAttribute("data-window-idle");
  // If frames keep arriving late, the scene switches once to half the streaks.
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
      resize();
    }
  };
  const loop = (now: number) => {
    frame = window.requestAnimationFrame(loop);
    if (idle()) { last = now; return; }
    if (now - last < FRAME_MS) return;
    const interval = now - (last || now);
    last = now;
    watch(interval);
    step(Math.min(0.1, interval / 1000));
    draw();
  };

  const observer = new ResizeObserver(() => { resize(); if (reduced) draw(); });
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
    draw();
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
