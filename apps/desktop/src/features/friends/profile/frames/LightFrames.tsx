import type { CSSProperties } from "react";
import { CENTER, fixed, polar } from "./frameGeometry";

const C = CENTER;

/** Glow: a neon tube that breathes, with two sparks racing round in opposite directions. */
export function GlowFrame({ id }: { id: string }) {
  return <>
    <circle className="frame-breathe" cx={C} cy={C} r="57" stroke="var(--frame)" strokeWidth="7" filter={`url(#${id}-bloom)`} />
    <circle cx={C} cy={C} r="57" stroke="var(--frame)" strokeWidth="2.6" />
    <circle cx={C} cy={C} r="57" stroke="var(--frame-light)" strokeWidth="1.1" />
    <g className="frame-spin" style={{ "--spin": "5.5s" } as CSSProperties}>
      <circle cx={C} cy={C} r="57" pathLength="100" stroke="var(--profile-paper)" strokeWidth="2.4" strokeLinecap="round"
        strokeDasharray="16 84" filter={`url(#${id}-soft)`} />
      <circle cx={C} cy="3" r="1.9" fill="var(--profile-paper)" filter={`url(#${id}-soft)`} />
    </g>
    <g className="frame-spin" style={{ "--spin": "8s", "--dir": "reverse" } as CSSProperties}>
      <circle cx={C} cy={C} r="57" pathLength="100" stroke="var(--frame-facet)" strokeWidth="1.8" strokeLinecap="round"
        strokeDasharray="10 90" strokeDashoffset="-50" filter={`url(#${id}-soft)`} />
    </g>
  </>;
}

const FACETS = 24;
const STEP = 360 / FACETS;

function facet(index: number, inner: number, outer: number) {
  const from = index * STEP + .25;
  const to = (index + 1) * STEP - .25;
  return [polar(from, outer), polar(to, outer), polar(to, inner), polar(from, inner)]
    .map(([x, y]) => `${fixed(x)},${fixed(y)}`).join(" ");
}

/** The hue shifts smoothly round the ring, like light split by glass; every other facet is cut brighter. */
function facetColor(index: number) {
  const shift = Math.round(Math.sin(index / FACETS * Math.PI * 2) * 70);
  const lift = index % 2 === 0 ? .1 : 0;
  return `oklch(from var(--frame) calc(l + ${lift}) c calc(h + ${shift}))`;
}

/**
 * Prism: a ring of cut glass. The colour drifts through neighbouring hues,
 * light runs from facet to facet and a glint circles over the cut.
 */
export function PrismFrame({ id }: { id: string }) {
  return <>
    <circle cx={C} cy={C} r="56.8" stroke="var(--profile-night)" strokeOpacity=".5" strokeWidth="6.6" />
    {Array.from({ length: FACETS }, (_, index) => <g key={index}>
      <polygon points={facet(index, 54, 59.6)} style={{ fill: facetColor(index) } as CSSProperties} fillOpacity=".9" />
      <polygon points={facet(index, 57.4, 59.6)} fill="var(--profile-paper)" fillOpacity=".22" />
      <polygon className="frame-facet-light" points={facet(index, 54, 59.6)} fill="var(--profile-paper)"
        style={{ "--d": `${(index * -2.4 / FACETS).toFixed(2)}s` } as CSSProperties} />
    </g>)}
    <circle cx={C} cy={C} r="54" stroke="var(--profile-paper)" strokeOpacity=".55" strokeWidth=".5" />
    <circle cx={C} cy={C} r="59.6" stroke="var(--profile-paper)" strokeOpacity=".4" strokeWidth=".5" />
    <g className="frame-spin" style={{ "--spin": "7s" } as CSSProperties}>
      <g transform="translate(60 3.2)"><path className="frame-glint" d="M0-6L.8-.8L6 0L.8.8L0 6L-.8.8L-6 0L-.8-.8Z" fill="var(--profile-paper)" /></g>
    </g>
  </>;
}
