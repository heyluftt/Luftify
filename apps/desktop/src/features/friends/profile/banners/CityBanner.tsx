import type { CSSProperties } from "react";
import { seeded } from "../frames/frameGeometry";

type Tower = { x: number; w: number; h: number; roof: number };
function skyline(seed: number, count: number, height: [number, number]): Tower[] {
  const random = seeded(seed);
  const towers: Tower[] = [];
  let x = -10;
  for (let index = 0; index < count && x < 910; index++) {
    const w = 28 + Math.round(random() * 46);
    towers.push({ x, w, h: Math.round(height[0] + random() * (height[1] - height[0])), roof: Math.floor(random() * 4) });
    x += w + Math.round(random() * 6);
  }
  return towers;
}
const FAR = skyline(3, 40, [60, 150]);
const NEAR = skyline(9, 30, [40, 120]);
const pick = seeded(17);
/** Lit windows on the near towers; some go on and off now and then. */
const WINDOWS = NEAR.flatMap((tower, index) => {
  const lit: { x: number; y: number; warm: boolean; blink: number | null }[] = [];
  for (let y = 300 - tower.h + 10; y < 292; y += 9) {
    for (let x = tower.x + 5; x < tower.x + tower.w - 6; x += 8) {
      if (pick() < .28) lit.push({ x, y, warm: pick() < .7, blink: pick() < .12 ? -pick() * 9 : null });
    }
  }
  return index % 5 === 4 ? lit.slice(0, 4) : lit;
});

/** A tower outline with its roof: flat, stepped, a spire or an antenna. */
function towerPath({ x, w, h, roof }: Tower) {
  const top = 300 - h;
  if (roof === 1) return `M${x} 300V${top + 8}H${x + w * .2}V${top}H${x + w * .8}V${top + 8}H${x + w}V300Z`;
  if (roof === 2) return `M${x} 300V${top}L${x + w / 2} ${top - 16}L${x + w} ${top}V300Z`;
  return `M${x} 300V${top}H${x + w}V300Z`;
}

/** City lights: two skylines against a glowing horizon, windows lit warm and cool. */
export function CityArt({ id }: { id: string }) {
  return <>
    <defs>
      <linearGradient id={`${id}-far-city`} x2="0" y2="1"><stop stopColor="color-mix(in srgb, var(--banner-accent) 30%, var(--profile-night))" /><stop offset="1" stopColor="color-mix(in srgb, var(--banner-accent) 14%, var(--profile-night))" /></linearGradient>
      <radialGradient id={`${id}-horizon`} cy="1"><stop stopColor="var(--banner-accent)" stopOpacity=".6" /><stop offset="1" stopColor="var(--banner-accent)" stopOpacity="0" /></radialGradient>
    </defs>
    <ellipse className="banner-sun-glow" cx="450" cy="300" rx="560" ry="170" fill={`url(#${id}-horizon)`} />
    <g fill={`url(#${id}-far-city)`}>{FAR.map((tower, index) => <path key={index} d={towerPath({ ...tower, x: tower.x, h: tower.h + 40 })} />)}</g>
    <g fill="var(--profile-night)">{NEAR.map((tower, index) => <path key={index} d={towerPath(tower)} />)}</g>
    {NEAR.filter((tower) => tower.roof === 3 && tower.h > 90).map((tower, index) =>
      <g key={index}>
        <path d={`M${tower.x + tower.w / 2} ${300 - tower.h}V${300 - tower.h - 22}`} stroke="var(--profile-night)" strokeWidth="2" />
        <circle className="banner-beacon" cx={tower.x + tower.w / 2} cy={300 - tower.h - 22} r="2" fill="var(--profile-coral)" style={{ "--d": `${-index * .7}s` } as CSSProperties} />
      </g>)}
    <g>
      {WINDOWS.map(({ x, y, warm, blink }, index) => <rect key={index} className={blink === null ? undefined : "banner-window"} x={x} y={y} width="3.4" height="4.2" rx=".6"
        fill={warm ? "var(--profile-gold-light)" : "var(--banner-light)"} opacity={warm ? .85 : .6}
        style={blink === null ? undefined : { "--d": `${blink.toFixed(2)}s` } as CSSProperties} />)}
    </g>
  </>;
}
