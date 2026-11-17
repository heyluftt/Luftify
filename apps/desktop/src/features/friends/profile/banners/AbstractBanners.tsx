import type { CSSProperties } from "react";
import { seeded } from "../frames/frameGeometry";

const random = seeded(53);

/** Ocean: under the surface, light falls in moving rays over a reef and swaying weeds. */
export function OceanArt({ id }: { id: string }) {
  return <>
    <defs>
      <linearGradient id={`${id}-ray`} x2="0" y2="1"><stop stopColor="var(--profile-paper)" stopOpacity=".5" /><stop offset="1" stopColor="var(--profile-paper)" stopOpacity="0" /></linearGradient>
      <linearGradient id={`${id}-reef`} x2="0" y2="1"><stop stopColor="color-mix(in srgb, var(--banner-accent) 30%, var(--profile-night))" /><stop offset="1" stopColor="var(--profile-night)" /></linearGradient>
    </defs>
    <path className="banner-surface" d="M-20 18Q60 6 140 18T300 18T460 18T620 18T780 18T940 18" stroke="var(--profile-paper)" strokeOpacity=".45" strokeWidth="2" fill="none" />
    <g className="banner-rays" fill={`url(#${id}-ray)`}>
      <path d="M210 0H250L330 300H200Z" opacity=".5" />
      <path d="M360 0H380L450 300H380Z" opacity=".35" />
      <path d="M470 0H520L640 300H500Z" opacity=".45" />
      <path d="M640 0H660L740 300H690Z" opacity=".3" />
    </g>
    <path d="M0 268Q60 238 120 256T240 250Q300 230 360 262T520 258Q600 232 680 256T900 248V300H0Z" fill={`url(#${id}-reef)`} />
    <g className="banner-weeds" stroke="color-mix(in srgb, var(--profile-mint) 45%, var(--profile-night))" strokeWidth="3" strokeLinecap="round" fill="none">
      {[60, 84, 110, 590, 618, 820, 846].map((x, index) => <path key={index} d={`M${x} 300Q${x - 12} ${260 - index % 3 * 10} ${x + 4} ${232 - index % 2 * 18}T${x - 2} ${190 - index % 3 * 12}`}
        style={{ "--d": `${-index * .8}s` } as CSSProperties} />)}
    </g>
    <g className="banner-motes" fill="var(--profile-paper)">
      {Array.from({ length: 14 }, (_, index) => <circle key={index} cx={Math.round(random() * 900)} cy={Math.round(60 + random() * 180)} r={(.8 + random() * 1.4).toFixed(2)}
        opacity={(.3 + random() * .4).toFixed(2)} />)}
    </g>
  </>;
}

/** Nebula: a slowly turning spiral galaxy in coloured dust. */
export function NebulaArt({ id }: { id: string }) {
  const arm = "M0 0C40-10 90-10 130 20S160 90 110 110";
  return <>
    <defs>
      <radialGradient id={`${id}-core`}><stop stopColor="var(--profile-paper)" /><stop offset=".3" stopColor="var(--profile-paper)" stopOpacity=".6" /><stop offset="1" stopColor="var(--banner-accent)" stopOpacity="0" /></radialGradient>
      <linearGradient id={`${id}-arm`}><stop stopColor="var(--profile-paper)" stopOpacity=".8" /><stop offset=".5" stopColor="var(--banner-accent)" stopOpacity=".7" /><stop offset="1" stopColor="var(--profile-rose)" stopOpacity="0" /></linearGradient>
    </defs>
    <g className="banner-dust" filter={`url(#${id}-blur-wide)`}>
      <ellipse cx="300" cy="190" rx="240" ry="70" fill="var(--banner-accent)" opacity=".35" />
      <ellipse cx="640" cy="90" rx="220" ry="60" fill="var(--profile-rose)" opacity=".3" />
      <ellipse cx="760" cy="230" rx="160" ry="50" fill="var(--profile-violet)" opacity=".35" />
    </g>
    <g className="banner-stars">
      {Array.from({ length: 34 }, (_, index) => <circle key={index} cx={Math.round(random() * 900)} cy={Math.round(random() * 300)} r={(.5 + random()).toFixed(2)}
        fill="var(--profile-paper)" style={{ "--d": `${(-random() * 5).toFixed(2)}s` } as CSSProperties} />)}
    </g>
    <g transform="translate(560 145) rotate(-18) scale(1 .42)">
      <g className="banner-galaxy" filter={`url(#${id}-blur)`}>
        {[0, 90, 180, 270].map((angle) => <path key={angle} d={arm} transform={`rotate(${angle})`} stroke={`url(#${id}-arm)`} strokeWidth={angle % 180 ? 7 : 12} strokeLinecap="round" fill="none" />)}
        <circle r="150" fill="none" stroke="var(--banner-light)" strokeOpacity=".12" strokeWidth="30" />
      </g>
      <circle r="46" fill={`url(#${id}-core)`} />
    </g>
  </>;
}

/** Candy floss: folded satin bands in pastel shades, with a sheen gliding over them. */
export function CandyArt({ id }: { id: string }) {
  return <>
    <defs>
      {[["var(--profile-paper)", "var(--profile-rose)"], ["var(--profile-rose)", "var(--profile-violet)"], ["var(--banner-accent)", "var(--profile-paper)"]].map(([from, to], index) =>
        <linearGradient key={index} id={`${id}-satin-${index}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={from} stopOpacity=".55" /><stop offset=".5" stopColor={to} stopOpacity=".45" /><stop offset="1" stopColor={from} stopOpacity=".2" />
        </linearGradient>)}
    </defs>
    <g className="banner-folds">
      <path d="M-60 220Q140 40 360 150T760 110T980 160V320H-60Z" fill={`url(#${id}-satin-0)`} />
      <path d="M-60 120Q160 260 420 170T980 60V-20H-60Z" fill={`url(#${id}-satin-1)`} />
      <path d="M-60 270Q220 170 480 240T980 210V320H-60Z" fill={`url(#${id}-satin-2)`} />
      <path d="M-60 220Q140 40 360 150T760 110T980 160" stroke="var(--profile-paper)" strokeOpacity=".55" strokeWidth="1.2" fill="none" />
      <path d="M-60 120Q160 260 420 170T980 60" stroke="var(--profile-paper)" strokeOpacity=".3" fill="none" />
    </g>
  </>;
}

/** A closed, gently wavy contour around a centre. */
function contour(cx: number, cy: number, radius: number, phase: number) {
  const points: string[] = [];
  for (let step = 0; step <= 36; step++) {
    const a = step / 36 * Math.PI * 2;
    const r = radius * (1 + .07 * Math.sin(3 * a + phase) + .04 * Math.cos(5 * a - phase));
    points.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r * .8).toFixed(1)}`);
  }
  return `M${points.join("L")}Z`;
}

/** Plain: calm contour lines like a map of hills, in the profile colour. */
export function MonoArt() {
  return <g className="banner-contours" fill="none" stroke="var(--banner-light)" strokeWidth="1">
    {Array.from({ length: 9 }, (_, index) => <path key={`a${index}`} d={contour(780, 10, 40 + index * 34, index * .6)} strokeOpacity={(.32 - index * .025).toFixed(3)} />)}
    {Array.from({ length: 5 }, (_, index) => <path key={`b${index}`} d={contour(130, 320, 50 + index * 36, index)} strokeOpacity={(.22 - index * .03).toFixed(3)} />)}
  </g>;
}
