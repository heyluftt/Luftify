import { useEffect, useRef, useState, type CSSProperties } from "react";
import { startAbyssParticles } from "./abyssParticles";
import { useAbyssPulse } from "./useAbyssPulse";

interface Jelly { id: string; color: string; second: string; size: number; x: number; depth: "far" | "mid" | "near"; drift: number; phase: number; pulse: number }
/**
 * Most swim near the sides, where pages leave the water visible; the far
 * ones pass behind the content. `phase` spreads them over their cycle, so
 * several are always on their way up.
 */
const JELLIES: Jelly[] = [
  { id: "a", color: "92 232 218", second: "150 190 255", size: 190, x: 8, depth: "near", drift: 96, phase: 0.15, pulse: 4.4 },
  { id: "b", color: "228 107 255", second: "92 232 218", size: 150, x: 91, depth: "near", drift: 112, phase: 0.6, pulse: 3.9 },
  { id: "c", color: "150 190 255", second: "228 107 255", size: 96, x: 17, depth: "mid", drift: 130, phase: 0.72, pulse: 3.4 },
  { id: "d", color: "120 245 236", second: "228 107 255", size: 88, x: 82, depth: "mid", drift: 124, phase: 0.3, pulse: 3.6 },
  { id: "e", color: "228 107 255", second: "150 190 255", size: 58, x: 44, depth: "far", drift: 170, phase: 0.45, pulse: 3.1 },
  { id: "f", color: "92 232 218", second: "120 245 236", size: 46, x: 63, depth: "far", drift: 190, phase: 0.9, pulse: 2.8 },
];

const BUBBLES = [
  [6, 7, 0, 5], [7, 9, -3, 3], [93, 11, -6, 4], [94, 8, -1.5, 6], [88, 12, -8, 3], [12, 10, -4.5, 4], [13, 13, -9.5, 3],
] as const;

/** A moon jelly: canals in the bell, a glowing rim, frilled arms and long tentacles. */
function JellySvg({ jelly }: { jelly: Jelly }) {
  const bell = `abyss-bell-${jelly.id}`;
  const fade = `abyss-fade-${jelly.id}`;
  return <>
    <svg className="abyss-jelly-tentacles" viewBox="0 0 100 160" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`rgb(${jelly.color})`} stopOpacity=".75" />
          <stop offset=".55" stopColor={`rgb(${jelly.second})`} stopOpacity=".28" />
          <stop offset="1" stopColor={`rgb(${jelly.second})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      {["M10 0c-3 30 5 58-2 88s4 50-1 72", "M24 0c3 34-5 62 2 94s-4 44 1 66", "M76 0c-3 34 5 62-2 94s4 44-1 66", "M90 0c3 30-5 58 2 88s-4 50 1 72",
        "M40 0c-2 26 4 50-1 78s3 54 0 82", "M60 0c2 26-4 50 1 78s-3 54 0 82"].map((d, index) =>
        <path key={index} d={d} fill="none" stroke={`url(#${fade})`} strokeWidth={index > 3 ? 1.1 : 0.8} strokeLinecap="round" />)}
      {/* Frilled oral arms */}
      <path d="M44 0c-6 10 6 16-2 26s6 16-1 26 5 14 0 22" fill="none" stroke={`url(#${fade})`} strokeWidth="5" strokeLinecap="round" opacity=".55" />
      <path d="M56 0c6 10-6 16 2 26s-6 16 1 26-5 14 0 22" fill="none" stroke={`url(#${fade})`} strokeWidth="5" strokeLinecap="round" opacity=".55" />
    </svg>
    <svg className="abyss-jelly-bell" viewBox="0 0 100 60" aria-hidden="true">
      <defs>
        <radialGradient id={bell} cx="50%" cy="15%" r="80%">
          <stop offset="0" stopColor="rgb(255 255 255)" stopOpacity=".55" />
          <stop offset=".25" stopColor={`rgb(${jelly.color})`} stopOpacity=".55" />
          <stop offset=".7" stopColor={`rgb(${jelly.second})`} stopOpacity=".22" />
          <stop offset="1" stopColor={`rgb(${jelly.color})`} stopOpacity=".08" />
        </radialGradient>
      </defs>
      <path d="M4 54C4 22 25 3 50 3s46 19 46 51c-5 3-10 3-15 0-5 3-10 3-15 0-5 3-11 3-16 0-5 3-11 3-16 0-5 3-10 3-15 0-5 3-9 3-15 0Z" fill={`url(#${bell})`} />
      {/* Radial canals */}
      {[18, 30, 42, 58, 70, 82].map((x) => <path key={x} d={`M50 10Q${(50 + x) / 2} ${28} ${x} 53`} fill="none" stroke={`rgb(${jelly.color} / 28%)`} strokeWidth=".7" />)}
      {/* The moon jelly's four organs: soft petals in a clover, seen slightly from the side */}
      <g transform="translate(0 31) scale(1 .55) translate(0 -31)">
        {[0, 90, 180, 270].map((angle) =>
          <ellipse key={angle} cx="50" cy="24.5" rx="3.6" ry="6" transform={`rotate(${angle} 50 31)`} fill={`rgb(${jelly.second} / 30%)`} />)}
      </g>
      {/* Glowing rim */}
      <path d="M4 54c5 3 10 3 15 0 5 3 10 3 15 0 5 3 11 3 16 0 5 3 11 3 16 0 5 3 10 3 15 0 5 3 10 3 15 0" fill="none" stroke={`rgb(${jelly.color} / 60%)`} strokeWidth=".9" />
      <path d="M18 34C22 18 34 9 48 8" fill="none" stroke="rgb(255 255 255 / 45%)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  </>;
}

/** One wing seen from above; the lower one is the same, mirrored. Head to the right. */
function MantaWing({ id }: { id: string }) {
  return <svg viewBox="0 0 130 82" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id={id} x1="1" y1="1" x2=".2" y2="0">
        <stop offset="0" stopColor="#0f4552" />
        <stop offset=".6" stopColor="#072630" />
        <stop offset="1" stopColor="#041820" />
      </linearGradient>
    </defs>
    <path d="M127 82C126 60 98 26 50 3C58 30 48 60 6 82Z" fill={`url(#${id})`} />
    {/* Light along the leading edge */}
    <path d="M127 82C126 60 98 26 50 3" fill="none" stroke="rgb(120 245 236 / 38%)" strokeWidth="1.2" />
    <path d="M114 72C106 50 88 28 62 16" fill="none" stroke="rgb(92 232 218 / 12%)" strokeWidth="6" strokeLinecap="round" />
    {/* The pale shoulder patch mantas carry */}
    <ellipse cx="96" cy="62" rx="16" ry="7" transform="rotate(-38 96 62)" fill="rgb(160 230 225 / 9%)" />
  </svg>;
}

/**
 * A manta ray seen from above, gliding past in the distance now and then.
 * Wings, body and tail move separately (abyss-atmosphere.css): both wings
 * beat together with the tips lagging, the body lifts on each stroke, the
 * tail trails, and the path curves gently with a little banking.
 */
function Manta() {
  return <i className="abyss-manta">
    <i className="abyss-manta-glide">
      <i className="abyss-manta-tail"><svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
        <path d="M100 3C70 2 40 4 0 3" fill="none" stroke="#0a3640" strokeWidth="2.4" strokeLinecap="round" />
      </svg></i>
      <i className="abyss-manta-wing" data-side="top"><i><MantaWing id="abyss-manta-wing-top" /></i></i>
      <i className="abyss-manta-wing" data-side="bottom"><i><MantaWing id="abyss-manta-wing-bottom" /></i></i>
      <i className="abyss-manta-body"><svg viewBox="0 0 160 40" aria-hidden="true">
        <defs>
          <linearGradient id="abyss-manta-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0d3f4a" />
            <stop offset=".5" stopColor="#0a3039" />
            <stop offset="1" stopColor="#06202a" />
          </linearGradient>
        </defs>
        <path d="M152 20C148 12 134 8 116 7L24 10C14 12 6 16 2 20C6 24 14 28 24 30L116 33C134 32 148 28 152 20Z" fill="url(#abyss-manta-body)" stroke="rgb(120 245 236 / 22%)" strokeWidth=".8" />
        {/* Cephalic fins */}
        <path d="M146 13q9-3 13-10M146 27q9 3 13 10" fill="none" stroke="#0d3f4a" strokeWidth="3.4" strokeLinecap="round" />
        {[[120, 16], [120, 24], [98, 14], [98, 26], [76, 20], [136, 20]].map(([cx, cy], index) =>
          <circle key={index} cx={cx} cy={cy} r="1.4" className="abyss-manta-spot" style={{ animationDelay: `${index * -0.7}s` }} />)}
      </svg></i>
    </i>
  </i>;
}

/**
 * Theme „Tiefsee“: deep water behind the content canvas (shell/atmosphere.css).
 * A web of light flickers at the surface and falls in shafts; plankton and
 * marine snow drift on a canvas (abyssParticles.ts); moon jellies rise and
 * pulse at several depths, a manta glides by, bubbles rise, kelp sways.
 * With music the glow swells and plankton flares with the beat.
 */
export function AbyssScene() {
  const [active, setActive] = useState(() => document.documentElement.dataset.theme === "luft.abyss");
  const scene = useRef<HTMLDivElement>(null);
  const particles = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setActive(root.dataset.theme === "luft.abyss");
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!active || !particles.current) return;
    return startAbyssParticles(particles.current);
  }, [active]);
  useAbyssPulse(scene, active);
  if (!active) return null;
  return <div ref={scene} className="abyss-scene" aria-hidden="true">
    <i className="abyss-caustics" />
    <i className="abyss-caustics abyss-caustics-b" />
    {[0, 1, 2, 3, 4].map((ray) => <i key={ray} className="abyss-ray" data-ray={ray} />)}
    <Manta />
    {JELLIES.map((jelly) => <i key={jelly.id} className="abyss-jelly" data-depth={jelly.depth}
      style={{ "--size": `${jelly.size}px`, "--x": `${jelly.x}%`, "--drift": `${jelly.drift}s`, "--delay": `${-jelly.phase * jelly.drift}s`,
        "--pulse": `${jelly.pulse}s`, "--glow": jelly.color } as CSSProperties}>
      <i className="abyss-jelly-sway">
        <i className="abyss-jelly-halo" />
        <i className="abyss-jelly-body">
          <JellySvg jelly={jelly} />
          {/* Light that flares as the bell contracts: rim and core, as layers of their own. */}
          <i className="abyss-jelly-rim" />
          <i className="abyss-jelly-core" />
        </i>
      </i>
    </i>)}
    <canvas ref={particles} className="abyss-particles" />
    {BUBBLES.map(([x, size, delay, speed], index) => <i key={index} className="abyss-bubble" data-extra={index % 2 === 1 || undefined}
      style={{ "--x": `${x}%`, "--s": `${size}px`, "--d": `${delay}s`, "--t": `${speed * 2.6}s` } as CSSProperties}><i /></i>)}
    <i className="abyss-kelp abyss-kelp-a" />
    <i className="abyss-kelp abyss-kelp-b" />
    <i className="abyss-kelp abyss-kelp-c" />
    <i className="abyss-kelp abyss-kelp-d" />
    <i className="abyss-floor" />
    <i className="abyss-vignette" />
  </div>;
}
