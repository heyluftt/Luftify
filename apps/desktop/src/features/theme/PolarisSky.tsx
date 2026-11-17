import { useEffect, useState } from "react";

/** Deterministic noise, so the sky looks the same on every start. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_COLORS = ["255 255 255", "214 232 255", "190 216 255", "242 220 162"];

/**
 * One layer of stars as box-shadows. The field is larger than the canvas
 * because it slowly turns around the north star; stars thin out towards
 * the horizon.
 */
function starField(seed: number, count: number, opts: { minA: number; maxA: number; gold: number; glow: number }) {
  const rnd = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = -45 + rnd() * 190;
    const y = -45 + Math.pow(rnd(), 1.35) * 185;
    const alpha = opts.minA + rnd() * (opts.maxA - opts.minA);
    const roll = rnd();
    const color = roll < opts.gold ? STAR_COLORS[3] : STAR_COLORS[Math.floor(rnd() * 3)];
    const glow = rnd() < opts.glow ? `${(0.6 + rnd() * 1.6).toFixed(1)}px` : "0";
    out.push(`${x.toFixed(2)}vw ${y.toFixed(2)}vh ${glow} rgb(${color} / ${alpha.toFixed(2)})`);
  }
  return out.join(", ");
}

/**
 * Dense faint stars inside the Milky Way band, in the band's own
 * (unrotated) coordinates: spread along its length, gathered around its
 * centre line.
 */
function bandField(seed: number, count: number) {
  const rnd = mulberry32(seed);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = rnd() * 130;
    const y = 17 + gauss() * 9;
    const alpha = 0.18 + rnd() * 0.45;
    const color = STAR_COLORS[rnd() < 0.08 ? 3 : Math.floor(rnd() * 3)];
    const glow = rnd() < 0.08 ? "1px" : "0";
    out.push(`${x.toFixed(2)}vw ${y.toFixed(2)}vh ${glow} rgb(${color} / ${alpha.toFixed(2)})`);
  }
  return out.join(", ");
}

const FIELDS = {
  band: bandField(151, 320),
  dust: starField(7, 260, { minA: 0.12, maxA: 0.34, gold: 0.02, glow: 0 }),
  far: starField(19, 120, { minA: 0.3, maxA: 0.62, gold: 0.05, glow: 0.12 }),
  near: starField(43, 38, { minA: 0.6, maxA: 0.95, gold: 0.12, glow: 0.55 }),
  twinkleA: starField(71, 12, { minA: 0.75, maxA: 1, gold: 0.25, glow: 0.9 }),
  twinkleB: starField(97, 10, { minA: 0.7, maxA: 1, gold: 0.2, glow: 0.9 }),
};

const LAYERS = [
  ["dust", FIELDS.dust],
  ["far", FIELDS.far],
  ["near", FIELDS.near],
  ["twinkle-a", FIELDS.twinkleA],
  ["twinkle-b", FIELDS.twinkleB],
] as const;

export function PolarisSky() {
  const [active, setActive] = useState(
    () => document.documentElement.dataset.theme === "luft.polaris",
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setActive(root.dataset.theme === "luft.polaris");
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    return () => observer.disconnect();
  }, []);

  if (!active) return null;

  return (
    <div className="polaris-sky" aria-hidden="true">
      <i className="polaris-glow" />
      <i className="polaris-rotor">
        <i className="polaris-milkyway">
          <i className="polaris-milkyway-dust" />
          <i className="polaris-milkyway-stars" style={{ boxShadow: FIELDS.band }} />
        </i>
        {LAYERS.map(([id, shadow]) => (
          <i key={id} className={`polaris-stars polaris-stars-${id}`} style={{ boxShadow: shadow }} />
        ))}
      </i>
      <i className="polaris-north" />
      <i className="polaris-meteor polaris-meteor-a" />
      <i className="polaris-meteor polaris-meteor-b" />
      <i className="polaris-ridge" />
      <i className="polaris-grain" />
    </div>
  );
}
