import { useEffect, useState, type CSSProperties } from "react";

const THEME = "luft.violet";

/** Deterministic noise, so the night looks the same on every start. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_COLORS = ["255 255 255", "226 220 255", "200 188 255", "255 214 244"];

/** Fine star dust as box-shadows, denser towards the top where the night is darkest. */
function dust(seed: number, count: number, minAlpha: number, maxAlpha: number, glow: number) {
  const random = seeded(seed);
  return Array.from({ length: count }, () => {
    const x = random() * 100;
    const y = Math.pow(random(), 1.6) * 92;
    const alpha = minAlpha + random() * (maxAlpha - minAlpha);
    const color = STAR_COLORS[Math.floor(random() * STAR_COLORS.length)];
    const blur = random() < glow ? `${(0.8 + random() * 1.4).toFixed(1)}px` : "0";
    return `${x.toFixed(2)}vw ${y.toFixed(2)}vh ${blur} rgb(${color} / ${alpha.toFixed(2)})`;
  }).join(", ");
}

const STARS = {
  far: dust(11, 150, 0.1, 0.32, 0),
  near: dust(29, 46, 0.35, 0.7, 0.3),
  twinkleA: dust(53, 10, 0.7, 1, 0.9),
  twinkleB: dust(87, 9, 0.65, 1, 0.9),
};

/** Air pearls rising: left in %, size in px, seconds per rise, start offset. */
const PEARLS = [
  [6, 7, 34, 0], [14, 4, 27, -9], [23, 9, 41, -21], [35, 5, 30, -4], [47, 6, 38, -27], [58, 4, 26, -14],
  [66, 8, 44, -33], [74, 5, 31, -18], [83, 10, 46, -7], [91, 6, 36, -25], [29, 3, 22, -12], [79, 3, 24, -2],
] as const;

/**
 * Luft Violet: night air. A slow aurora veil, moonlight from the top right,
 * star dust and small pearls of air rising through the dark. Only transform
 * and opacity move; a minimised window and reduced motion keep it still.
 */
export function VioletNight() {
  const [active, setActive] = useState(() => document.documentElement.dataset.theme === THEME);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setActive(root.dataset.theme === THEME);
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    return () => observer.disconnect();
  }, []);
  if (!active) return null;
  return <div className="violet-night" aria-hidden="true">
    <i className="violet-depth" />
    <i className="violet-stars violet-stars-far" style={{ boxShadow: STARS.far }} />
    <i className="violet-stars violet-stars-near" style={{ boxShadow: STARS.near }} />
    <i className="violet-stars violet-stars-twinkle-a" style={{ boxShadow: STARS.twinkleA }} />
    <i className="violet-stars violet-stars-twinkle-b" style={{ boxShadow: STARS.twinkleB }} />
    <i className="violet-moon" />
    <i className="violet-aurora">
      <i className="violet-ribbon violet-ribbon-a" />
      <i className="violet-ribbon violet-ribbon-b" />
      <i className="violet-ribbon violet-ribbon-c" />
    </i>
    {PEARLS.map(([x, size, rise, delay]) => <i key={`${x}-${size}`} className="violet-pearl"
      style={{ "--x": `${x}%`, "--size": `${size}px`, "--rise": `${rise}s`, "--delay": `${delay}s` } as CSSProperties} />)}
    <i className="violet-mist" />
  </div>;
}
