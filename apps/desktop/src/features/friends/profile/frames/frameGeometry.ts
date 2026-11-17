/** Frame art draws in a 120 × 120 box; the picture covers the circle of radius 53 in its middle. */
export const CENTER = 60;
export const PICTURE_R = 53;

/** A point at `angle` degrees (0 at the top, clockwise) and `radius` from the centre. */
export function polar(angle: number, radius: number): [number, number] {
  const a = (angle - 90) * Math.PI / 180;
  return [CENTER + Math.cos(a) * radius, CENTER + Math.sin(a) * radius];
}

export const fixed = (value: number) => Number(value.toFixed(2));

/** Same scatter on every render, so nothing jumps between frames or friends. */
export function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
