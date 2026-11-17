import type { CSSProperties } from "react";
import { CENTER, fixed, polar } from "./frameGeometry";

const C = CENTER;

/**
 * Profile colour: a polished band with a bevel. The highlight is part of the
 * band and turns with it, so the light seems to glide around the metal.
 */
export function AccentFrame({ id }: { id: string }) {
  return <>
    <circle cx={C} cy={C} r="56.6" stroke={`url(#${id}-metal)`} strokeWidth="5.4" />
    <circle cx={C} cy={C} r="53.9" stroke="var(--frame-dark)" strokeOpacity=".7" strokeWidth=".7" />
    <circle cx={C} cy={C} r="59.4" stroke="var(--frame-light)" strokeOpacity=".55" strokeWidth=".6" />
    <g className="frame-spin" style={{ "--spin": "11s" } as CSSProperties}>
      <circle cx={C} cy={C} r="56.6" pathLength="100" stroke="var(--profile-paper)" strokeWidth="2.6" strokeLinecap="round"
        strokeDasharray="7 43" filter={`url(#${id}-soft)`} opacity=".85" />
    </g>
    <g className="frame-spin" style={{ "--spin": "17s", "--dir": "reverse" } as CSSProperties}>
      <circle cx={C} cy={C} r="58.6" pathLength="100" stroke="var(--frame-light)" strokeWidth=".9" strokeLinecap="round" strokeDasharray="2 23" />
    </g>
  </>;
}

const LEAVES = [0, 1, 2, 3, 4, 5, 6, 7];

/** One laurel branch on the left; the right one is its mirror image. */
function Branch({ id }: { id: string }) {
  return <g>
    <path d={arc(184, 268, 61.2)} stroke={`url(#${id}-gold)`} strokeWidth="1.1" strokeLinecap="round" />
    {LEAVES.map((leaf) => {
      // Leaves grow towards the tip, alternately outwards and inwards.
      const angle = 188 + leaf * 10.5;
      const outward = leaf % 2 === 0;
      const [x, y] = polar(angle, outward ? 61.8 : 60.8);
      return <g key={leaf} className="frame-leaf" style={{ "--d": `${-leaf * .35}s` } as CSSProperties}
        transform={`translate(${fixed(x)} ${fixed(y)}) rotate(${angle + (outward ? 68 : 112)}) scale(${(1.25 - leaf * .04).toFixed(2)})`}>
        <path d="M0 0Q-2.8-4.6 0-9.6Q2.8-4.6 0 0Z" fill={`url(#${id}-gold)`} stroke="var(--profile-gold-shadow)" strokeOpacity=".6" strokeWidth=".35" />
        <path d="M0-.6V-8" stroke="var(--profile-gold-shadow)" strokeOpacity=".45" strokeWidth=".3" />
      </g>;
    })}
  </g>;
}

/** Points on a circle from one angle to another, as an SVG arc. */
function arc(from: number, to: number, radius: number) {
  const [x1, y1] = polar(from, radius);
  const [x2, y2] = polar(to, radius);
  return `M${fixed(x1)} ${fixed(y1)}A${radius} ${radius} 0 0 1 ${fixed(x2)} ${fixed(y2)}`;
}

/** Aurum: a gold band with a laurel wreath, a small crown jewel and a travelling glint. */
export function AurumFrame({ id }: { id: string }) {
  const [gx, gy] = polar(0, 59.6);
  return <>
    <circle cx={C} cy={C} r="56.6" stroke={`url(#${id}-gold)`} strokeWidth="5.4" />
    <circle cx={C} cy={C} r="53.9" stroke="var(--profile-gold-shadow)" strokeWidth=".8" />
    <circle cx={C} cy={C} r="59.4" stroke="var(--profile-gold-light)" strokeOpacity=".8" strokeWidth=".55" />
    <circle className="frame-detail" cx={C} cy={C} r="56.6" pathLength="120" stroke="var(--profile-gold-shadow)" strokeOpacity=".55"
      strokeWidth=".5" strokeDasharray=".4 2.6" />
    <g className="frame-spin" style={{ "--spin": "9s" } as CSSProperties}>
      <circle cx={C} cy={C} r="56.6" pathLength="100" stroke="var(--profile-gold-light)" strokeWidth="2.8" strokeLinecap="round"
        strokeDasharray="6 94" filter={`url(#${id}-soft)`} />
    </g>
    <g className="frame-laurel">
      <Branch id={id} />
      <g transform="translate(120 0) scale(-1 1)"><Branch id={id} /></g>
    </g>
    <g transform={`translate(${fixed(gx)} ${fixed(gy)})`}>
      <path d="M0-4.6L3 0L0 4.6L-3 0Z" fill={`url(#${id}-gold)`} stroke="var(--profile-gold-light)" strokeWidth=".5" />
      <path d="M0-4.6L0 4.6L3 0Z" fill="var(--profile-paper)" fillOpacity=".35" />
      <path className="frame-glint" d="M0-9L.9-1L9 0L.9 1L0 9L-.9 1L-9 0L-.9-1Z" fill="var(--profile-gold-light)" />
    </g>
  </>;
}
