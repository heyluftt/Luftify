import type { CSSProperties } from "react";

export type BrandPaint = (name: string) => string;

/** Drawing and motion use exactly the same SVG path, including tilted ellipses. */
export function OrbitTrack({ d, paint, period = 1, phase = 0, small = false }: {
  d: string; paint: BrandPaint; period?: number; phase?: number; small?: boolean;
}) {
  const style = {
    "--brand-path": `path("${d}")`,
    "--brand-lap": `calc(var(--brand-orbit-period) * ${period} * var(--motion-scale, 1))`,
    "--brand-phase": `calc(var(--brand-lap) * ${-phase})`,
  } as CSSProperties;
  return <g className="brand-track" style={style}>
    <path className="brand-track-line" d={d} stroke={paint("rim")} />
    <path className="brand-track-trail" d={d} pathLength="100" stroke="var(--brand-light)" />
    <g className="brand-track-satellite">
      <circle r={small ? 3.5 : 5.5} fill={paint("aura")} />
      <circle r={small ? 1.7 : 3} fill={paint("orb")} stroke="var(--brand-light)" strokeWidth=".65" />
      <circle cx={small ? -.45 : -.7} cy={small ? -.45 : -.9} r={small ? .45 : .7} fill="var(--brand-light)" />
    </g>
  </g>;
}

export const ROUND_TRACK = "M32 7a25 25 0 1 1 0 50a25 25 0 1 1 0-50";
