import type { CSSProperties } from "react";
import { seeded } from "../profile/frames/frameGeometry";
import { AuroraScene, WaveLines } from "./EffectScenes";

/** One tile of stars as box-shadows; three copies side by side drift seamlessly. */
const TILE = 640;
function starField(seed: number, count: number, size: number, tinted: number): string {
  const random = seeded(seed);
  const stars: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.round(random() * TILE);
    const y = Math.round(random() * 260);
    const alpha = Math.round((0.45 + random() * 0.55) * 100);
    const color = random() < tinted
      ? `color-mix(in srgb, var(--banner-accent) 60%, color-mix(in srgb, var(--profile-paper) ${alpha}%, transparent))`
      : `color-mix(in srgb, var(--profile-paper) ${alpha}%, transparent)`;
    for (let copy = 0; copy < 3; copy++) stars.push(`${x + copy * TILE}px ${y}px 0 ${size}px ${color}`);
  }
  return stars.join(",");
}

const STARS = [starField(7, 52, 0, 0.15), starField(19, 24, 0.5, 0.3), starField(43, 9, 1, 0.45)];

type Spot = { x: number; y: number; s: number; d: number; t: number };
/** Fixed scatters, so a profile looks the same for everyone and on every start. */
function scatter(seed: number, count: number, size: [number, number], cycle: number): Spot[] {
  const random = seeded(seed);
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(4 + random() * 92),
    y: Math.round(6 + random() * 86),
    s: Math.round(size[0] + random() * (size[1] - size[0])),
    d: -Number((random() * cycle).toFixed(2)),
    t: index % 3,
  }));
}
const FLARES = scatter(5, 6, [7, 15], 6);
const GLINTS = scatter(11, 18, [12, 30], 5);
const ORBS = scatter(23, 14, [14, 64], 18);
const PETALS = scatter(37, 16, [9, 16], 14);

const place = ({ x, y, s, d }: Spot): CSSProperties => ({
  "--x": `${x}%`, "--y": `${y}%`, "--s": `${s}px`, "--d": `${d}s`,
} as CSSProperties);

/** The animated layer over a profile banner (styles in profile-effects.css). */
export function BannerEffect({ effect }: { effect: string }) {
  let parts: React.ReactNode = null;
  if (effect === "stars") {
    parts = <>
      <i className="fx-milky-way" />
      {STARS.map((shadow, layer) => <i key={layer} className="fx-star-layer" data-layer={layer} style={{ boxShadow: shadow }} />)}
      {FLARES.map((spot, index) => <i key={index} className="fx-flare" style={place(spot)} />)}
      <i className="fx-shooting" />
      <i className="fx-shooting" data-trail="second" />
    </>;
  } else if (effect === "sparkle") {
    parts = <>
      <i className="fx-sparkle-sweep" />
      {GLINTS.map((spot, index) => <i key={index} className="fx-glint" data-tint={spot.t} style={place(spot)} />)}
    </>;
  } else if (effect === "waves") {
    parts = <WaveLines />;
  } else if (effect === "veil") {
    parts = <AuroraScene />;
  } else if (effect === "lights") {
    parts = <>
      <i className="fx-light-bloom" /><i className="fx-light-bloom" data-layer="1" />
      {ORBS.map((spot, index) => <i key={index} className="fx-orb" data-tint={spot.t} style={place(spot)} />)}
    </>;
  } else if (effect === "petals") {
    parts = PETALS.map((spot, index) => <i key={index} className="fx-petal" data-tint={spot.t} style={place(spot)} />);
  }
  if (!parts) return null;
  return <span className="banner-effect" data-effect={effect} aria-hidden="true">{parts}</span>;
}
