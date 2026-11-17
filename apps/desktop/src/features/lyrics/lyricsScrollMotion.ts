import { prefersLessMotion } from "../motion/motionLevel";

const FOLLOW_FREQUENCY = 12.5;
const MAX_FOLLOW_VELOCITY = 2_800;
const SETTLED_DISTANCE = 0.45;
const SETTLED_VELOCITY = 3;

export interface LyricsScrollGeometry {
  readerScrollTop: number;
  readerScrollHeight: number;
  readerClientHeight: number;
  readerTop: number;
  lineTop: number;
  lineHeight: number;
  anchorRatio?: number;
}

export interface LyricsSpringState {
  position: number;
  velocity: number;
}

export function lyricsScrollTarget({
  readerScrollTop,
  readerScrollHeight,
  readerClientHeight,
  readerTop,
  lineTop,
  lineHeight,
  anchorRatio = 0.43,
}: LyricsScrollGeometry): number {
  const maximum = Math.max(0, readerScrollHeight - readerClientHeight);
  const lineCenter =
    readerScrollTop + lineTop - readerTop + lineHeight / 2;
  const requested = lineCenter - readerClientHeight * anchorRatio;

  return clamp(requested, 0, maximum);
}

export function advanceLyricsSpring(
  state: LyricsSpringState,
  target: number,
  deltaSeconds: number,
): LyricsSpringState {
  const delta = clamp(deltaSeconds, 0.001, 0.032);
  const distance = target - state.position;
  const acceleration =
    distance * FOLLOW_FREQUENCY ** 2 -
    state.velocity * 2 * FOLLOW_FREQUENCY;
  const velocity = clamp(
    state.velocity + acceleration * delta,
    -MAX_FOLLOW_VELOCITY,
    MAX_FOLLOW_VELOCITY,
  );
  const position = state.position + velocity * delta;

  if (
    Math.sign(target - position) !== Math.sign(distance) &&
    Math.abs(distance) > SETTLED_DISTANCE
  ) {
    return { position: target, velocity: 0 };
  }

  return { position, velocity };
}

export class LyricsScrollMotion {
  private frameId: number | null = null;
  private lastFrameAt: number | null = null;
  private target = 0;
  private velocity = 0;

  constructor(private readonly reader: HTMLElement) {}

  retarget(requestedTarget: number, immediate = false) {
    const maximum = Math.max(
      0,
      this.reader.scrollHeight - this.reader.clientHeight,
    );
    const nextTarget = clamp(requestedTarget, 0, maximum);
    const nextDirection = Math.sign(nextTarget - this.reader.scrollTop);

    if (
      nextDirection !== 0 &&
      Math.sign(this.velocity) !== 0 &&
      Math.sign(this.velocity) !== nextDirection
    ) {
      this.velocity = 0;
    }

    this.target = nextTarget;

    if (immediate || prefersReducedMotion()) {
      this.jumpTo(this.target);
      return;
    }

    if (
      Math.abs(this.target - this.reader.scrollTop) <= SETTLED_DISTANCE &&
      Math.abs(this.velocity) <= SETTLED_VELOCITY
    ) {
      this.reader.scrollTop = this.target;
      return;
    }

    if (this.frameId === null) {
      this.lastFrameAt = null;
      this.frameId = requestAnimationFrame(this.step);
    }
  }

  jumpTo(requestedTarget: number) {
    this.stop();
    const maximum = Math.max(
      0,
      this.reader.scrollHeight - this.reader.clientHeight,
    );
    this.target = clamp(requestedTarget, 0, maximum);
    this.reader.scrollTop = this.target;
  }

  stop() {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    this.lastFrameAt = null;
    this.velocity = 0;
  }

  destroy() {
    this.stop();
  }

  private readonly step = (timestamp: number) => {
    this.frameId = null;
    const deltaSeconds =
      this.lastFrameAt === null
        ? 1 / 60
        : (timestamp - this.lastFrameAt) / 1_000;
    this.lastFrameAt = timestamp;

    const next = advanceLyricsSpring(
      {
        position: this.reader.scrollTop,
        velocity: this.velocity,
      },
      this.target,
      deltaSeconds,
    );

    this.reader.scrollTop = next.position;
    this.velocity = next.velocity;

    const remaining = this.target - this.reader.scrollTop;
    if (
      Math.abs(remaining) <= SETTLED_DISTANCE &&
      Math.abs(this.velocity) <= SETTLED_VELOCITY
    ) {
      this.reader.scrollTop = this.target;
      this.lastFrameAt = null;
      this.velocity = 0;
      return;
    }

    this.frameId = requestAnimationFrame(this.step);
  };
}

function prefersReducedMotion(): boolean {
  return prefersLessMotion();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
