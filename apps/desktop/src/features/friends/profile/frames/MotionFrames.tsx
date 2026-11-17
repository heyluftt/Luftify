import type { CSSProperties } from "react";
import { CENTER, fixed, polar, seeded } from "./frameGeometry";

const C = CENTER;
const TILT = -22;
const RX = 70;
const RY = 17;
/** The ring as a path, so moons can travel along it. */
const RING = `M${C - RX} ${C}A${RX} ${RY} 0 1 0 ${C + RX} ${C}A${RX} ${RY} 0 1 0 ${C - RX} ${C}Z`;

/**
 * Orbit: a tilted ring around the picture, like a planet's. Its far half
 * passes behind the picture, the near half in front; two moons follow it.
 * `layer` is which of the two drawings this is (see AvatarFrameArt).
 */
export function OrbitFrame({ id, layer }: { id: string; layer: "back" | "front" }) {
  const front = layer === "front";
  const moons = <>
    <circle r="3.2" fill="var(--frame-light)" filter={`url(#${id}-soft)`}>
      <animateMotion dur="9s" repeatCount="indefinite" path={RING} />
    </circle>
    <circle r="1.7" fill="var(--profile-paper)">
      <animateMotion dur="14s" begin="-5s" repeatCount="indefinite" path={RING} />
    </circle>
  </>;
  return <g className="frame-rock"><g transform={`rotate(${TILT} ${C} ${C})`}>
    {!front && <circle cx={C} cy={C} r="55.5" stroke="var(--frame)" strokeOpacity=".45" strokeWidth="1.2" />}
    <g mask={`url(#${id}-${front ? "near" : "far"})`}>
      <path d={RING} stroke="var(--frame)" strokeOpacity=".35" strokeWidth="4.5" filter={`url(#${id}-soft)`} />
      <path d={RING} stroke={`url(#${id}-orbit)`} strokeWidth="1.4" />
      <path className="frame-orbit-trail" d={RING} pathLength="100" stroke="var(--profile-paper)" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="12 88" />
      {moons}
    </g>
  </g></g>;
}

const BARS = 48;
const pick = seeded(31);
const BAR_TIMING = Array.from({ length: BARS }, () => ({ speed: .7 + pick() * .8, delay: -pick() * 2 }));

/** Pulse: a round equaliser. Bars around the picture rise and fall like music. */
export function PulseFrame({ id }: { id: string }) {
  return <>
    <circle cx={C} cy={C} r="55.6" stroke="var(--frame-dark)" strokeWidth="3.6" />
    <circle cx={C} cy={C} r="55.6" stroke="var(--frame)" strokeOpacity=".75" strokeWidth="1.2" />
    <g filter={`url(#${id}-soft-glow)`}>
      {BAR_TIMING.map(({ speed, delay }, index) => {
        const angle = index * 360 / BARS;
        const [x, y] = polar(angle, 57.6);
        return <g key={index} transform={`translate(${fixed(x)} ${fixed(y)}) rotate(${angle})`}>
          <rect className="frame-bar" x="-.75" y="-6" width="1.5" height="6" rx=".75" fill={`url(#${id}-bar)`}
            style={{ "--speed": `${speed.toFixed(2)}s`, "--d": `${delay.toFixed(2)}s` } as CSSProperties} />
        </g>;
      })}
    </g>
  </>;
}
