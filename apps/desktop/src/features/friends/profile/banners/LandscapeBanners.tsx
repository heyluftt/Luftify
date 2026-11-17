import type { CSSProperties } from "react";
import { seeded } from "../frames/frameGeometry";

const random = seeded(71);
const STARS = Array.from({ length: 26 }, () => ({ x: Math.round(random() * 900), y: Math.round(random() * 150), r: .6 + random() * 1.1, d: -random() * 5 }));
/** Pines along a hill: x, foot and height. */
const PINES = Array.from({ length: 22 }, (_, index) => {
  const x = index < 11 ? 10 + index * 19 + random() * 8 : 640 + (index - 11) * 23 + random() * 8;
  return { x, foot: 262 + Math.sin(x / 70) * 6, h: 18 + random() * 20 };
});

function Stars() {
  return <g className="banner-stars">
    {STARS.map((star, index) => <circle key={index} cx={star.x} cy={star.y} r={star.r.toFixed(2)} fill="var(--profile-paper)"
      style={{ "--d": `${star.d.toFixed(2)}s` } as CSSProperties} />)}
  </g>;
}

/** Aurora: curtains of light over two mountain ranges and a dark pine ridge. */
export function AuroraArt({ id }: { id: string }) {
  return <>
    <defs>
      <linearGradient id={`${id}-far`} x2="0" y2="1"><stop stopColor="color-mix(in srgb, var(--banner-accent) 38%, var(--profile-night))" /><stop offset="1" stopColor="var(--profile-night)" /></linearGradient>
      <linearGradient id={`${id}-curtain`} x2="0" y2="1">
        <stop stopColor="var(--profile-mint)" stopOpacity="0" /><stop offset=".55" stopColor="var(--profile-mint)" stopOpacity=".45" />
        <stop offset=".9" stopColor="var(--banner-accent)" stopOpacity=".75" /><stop offset="1" stopColor="var(--profile-paper)" stopOpacity=".2" />
      </linearGradient>
    </defs>
    <Stars />
    <g className="banner-curtains" filter={`url(#${id}-blur)`}>
      <path d="M-40 40C120 10 210 120 380 70S640 10 940 60L940 150C640 110 560 170 380 150S120 90-40 135Z" fill={`url(#${id}-curtain)`} />
      <path className="banner-curtain-second" d="M150 20C320 60 420-10 560 40S760 120 940 30L940 105C770 160 700 90 560 115S320 120 150 100Z" fill={`url(#${id}-curtain)`} opacity=".7" />
    </g>
    <path d="M0 232L58 192L104 214L168 158L226 203L288 176L346 220L418 150L478 200L540 168L602 214L664 163L730 205L790 178L850 210L900 186V300H0Z" fill={`url(#${id}-far)`} />
    <path d="M155 170L168 158L181 172M405 162L418 150L432 165M651 175L664 163L678 177" stroke="var(--profile-paper)" strokeOpacity=".5" strokeWidth="1.2" fill="none" />
    <path d="M0 262Q90 228 172 252T330 246T520 258T700 242T900 256V300H0Z" fill="var(--profile-night)" />
    <g fill="var(--profile-night)">
      {PINES.map(({ x, foot, h }, index) => <path key={index}
        d={`M${x.toFixed(1)} ${(foot - h).toFixed(1)}L${(x - h * .28).toFixed(1)} ${(foot - h * .45).toFixed(1)}H${(x - h * .14).toFixed(1)}L${(x - h * .36).toFixed(1)} ${foot.toFixed(1)}H${(x + h * .36).toFixed(1)}L${(x + h * .14).toFixed(1)} ${(foot - h * .45).toFixed(1)}H${(x + h * .28).toFixed(1)}Z`} />)}
    </g>
  </>;
}

/** Sunset: a low sun over the sea, drifting cloud bands, layered hills and a glittering reflection. */
export function SunsetArt({ id }: { id: string }) {
  return <>
    <defs>
      <radialGradient id={`${id}-sun`}><stop stopColor="var(--profile-paper)" /><stop offset=".55" stopColor="var(--profile-gold-light)" /><stop offset="1" stopColor="var(--profile-gold)" /></radialGradient>
      <radialGradient id={`${id}-sun-glow`}><stop stopColor="var(--profile-gold-light)" stopOpacity=".7" /><stop offset=".4" stopColor="var(--profile-coral)" stopOpacity=".35" /><stop offset="1" stopColor="var(--profile-coral)" stopOpacity="0" /></radialGradient>
      <linearGradient id={`${id}-sea`} x2="0" y2="1"><stop stopColor="color-mix(in srgb, var(--profile-coral) 55%, var(--profile-violet))" /><stop offset="1" stopColor="color-mix(in srgb, var(--profile-violet) 30%, var(--profile-night))" /></linearGradient>
    </defs>
    <circle className="banner-sun-glow" cx="640" cy="196" r="150" fill={`url(#${id}-sun-glow)`} />
    <g className="banner-clouds" fill="var(--profile-gold-light)">
      <rect x="430" y="96" width="300" height="7" rx="3.5" opacity=".28" />
      <rect x="500" y="118" width="220" height="5" rx="2.5" opacity=".22" />
      <rect x="120" y="70" width="260" height="6" rx="3" opacity=".18" />
      <rect x="690" y="140" width="190" height="6" rx="3" opacity=".2" />
    </g>
    <circle cx="640" cy="196" r="36" fill={`url(#${id}-sun)`} />
    <rect y="206" width="900" height="94" fill={`url(#${id}-sea)`} />
    <g className="banner-glitter" stroke="var(--profile-gold-light)" strokeLinecap="round">
      {([[214, 60], [224, 46], [234, 52], [246, 34], [258, 40], [272, 24], [288, 28]] as const).map(([y, w], index) =>
        <line key={index} x1={640 - w / 2} x2={640 + w / 2} y1={y} y2={y} strokeWidth={2.2 - index * .2} style={{ "--d": `${-index * .4}s` } as CSSProperties} />)}
    </g>
    <path d="M0 214Q60 160 140 188T270 196Q320 200 360 214H0Z" fill="color-mix(in srgb, var(--profile-violet) 40%, var(--profile-night))" />
    <path d="M0 252Q90 214 190 238T380 300H0Z" fill="var(--profile-night)" fillOpacity=".85" />
    <path d="M900 222Q850 186 780 200T700 222Z" fill="color-mix(in srgb, var(--profile-violet) 40%, var(--profile-night))" />
    <path d="M900 262Q830 226 740 250T620 300H900Z" fill="var(--profile-night)" fillOpacity=".85" />
  </>;
}

const GLITTER = Array.from({ length: 12 }, (_, index) => ({ y: 214 + index * 7, w: 46 - index * 2.6 + random() * 10, d: -random() * 3 }));

/** Midnight: a full moon with its halo, a calm sea and a path of moonlight on the water. */
export function MidnightArt({ id }: { id: string }) {
  return <>
    <defs>
      <radialGradient id={`${id}-halo`}><stop stopColor="var(--profile-paper)" stopOpacity=".5" /><stop offset=".3" stopColor="var(--banner-light)" stopOpacity=".2" /><stop offset="1" stopColor="var(--banner-light)" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${id}-moon`} cx=".42" cy=".4"><stop stopColor="var(--profile-paper)" /><stop offset="1" stopColor="color-mix(in srgb, var(--banner-light) 60%, var(--profile-paper))" /></radialGradient>
      <linearGradient id={`${id}-water`} x2="0" y2="1"><stop stopColor="color-mix(in srgb, var(--banner-accent) 28%, var(--profile-night))" /><stop offset="1" stopColor="var(--profile-night)" /></linearGradient>
    </defs>
    <Stars />
    <circle className="banner-moon-halo" cx="700" cy="92" r="110" fill={`url(#${id}-halo)`} />
    <circle cx="700" cy="92" r="27" fill={`url(#${id}-moon)`} />
    <g fill="var(--profile-night)" fillOpacity=".08"><circle cx="692" cy="84" r="6" /><circle cx="709" cy="100" r="8" /><circle cx="712" cy="81" r="3" /></g>
    <path d="M0 210Q110 176 220 196T430 192Q480 196 520 210Z" fill="color-mix(in srgb, var(--banner-accent) 22%, var(--profile-night))" />
    <rect y="208" width="900" height="92" fill={`url(#${id}-water)`} />
    <g className="banner-glitter" stroke="var(--profile-paper)" strokeLinecap="round">
      {GLITTER.map(({ y, w, d }, index) => <line key={index} x1={(700 - w / 2).toFixed(1)} x2={(700 + w / 2).toFixed(1)} y1={y} y2={y}
        strokeWidth={(1.6 - index * .08).toFixed(2)} style={{ "--d": `${d.toFixed(2)}s` } as CSSProperties} />)}
    </g>
  </>;
}
