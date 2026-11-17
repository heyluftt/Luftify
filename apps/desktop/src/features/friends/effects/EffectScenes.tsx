import { useId, type CSSProperties } from "react";

/** One wave period is 400 wide; two periods side by side scroll seamlessly. */
function wave(height: number, base: number) {
  let path = `M0 ${base}`;
  for (let x = 0; x < 1600; x += 400) {
    path += `C${x + 100} ${base - height} ${x + 100} ${base - height} ${x + 200} ${base}S${x + 300} ${base + height} ${x + 400} ${base}`;
  }
  return path;
}

const LINES = [
  { base: 190, height: 26, speed: 26, width: 1.4, opacity: .9 },
  { base: 205, height: 18, speed: 34, width: 1, opacity: .6 },
  { base: 222, height: 30, speed: 21, width: 1.8, opacity: .75 },
  { base: 240, height: 14, speed: 42, width: .8, opacity: .5 },
  { base: 255, height: 22, speed: 29, width: 1.2, opacity: .65 },
];

/** Waves: fine lines of light flowing like sound across the lower banner. */
export function WaveLines() {
  const id = useId().replace(/:/g, "");
  return <span className="fx-wave-lines">
    {LINES.map((line, index) => <svg key={index} className="fx-wave-line" viewBox="0 0 1600 300" preserveAspectRatio="none" aria-hidden="true"
      style={{ "--speed": `${line.speed}s`, "--d": `${-index * 3}s`, opacity: line.opacity } as CSSProperties}>
      <defs>
        <linearGradient id={`${id}-${index}`} x1="0" x2="1">
          {[0, .25, .5, .75, 1].map((offset, stop) =>
            <stop key={stop} offset={offset} stopColor={stop % 2 ? "var(--profile-paper)" : index % 2 ? "var(--profile-mint)" : "var(--banner-accent)"} />)}
        </linearGradient>
      </defs>
      <path d={wave(line.height, line.base)} fill="none" stroke={`url(#${id}-${index})`} strokeWidth={line.width} vectorEffect="non-scaling-stroke" />
      {index === 2 && <path d={`${wave(line.height, line.base)}V300H0Z`} fill="var(--banner-accent)" fillOpacity=".08" />}
    </svg>)}
  </span>;
}

/** Aurora veil: soft folding curtains with a woven texture and a lit lower edge. */
export function AuroraScene() {
  const id = useId().replace(/:/g, "");
  const ribbons = [
    "M-100 115C80-45 172 244 380 110S662 0 910 135L910 180C656 60 536 64 380 152S68 44-100 170Z",
    "M-100 245C70 54 318 322 482 175S684 56 910 30L910 85C682 82 648 111 482 225S70 142-100 282Z",
    "M-100 70C140 120 228-8 440 48S680 252 910 80L910 131C690 299 660 159 440 87S123 165-100 110Z",
  ];
  return <svg className="fx-aurora-scene" viewBox="0 0 800 300" preserveAspectRatio="none" aria-hidden="true">
    <defs>{["var(--profile-mint)", "var(--banner-accent)", "var(--profile-violet)"].map((color, index) =>
      <linearGradient key={index} id={`${id}-ribbon-${index}`} x2="0" y2="1">
        <stop stopColor={color} stopOpacity="0" /><stop offset=".45" stopColor={color} stopOpacity=".25" />
        <stop offset=".86" stopColor={color} stopOpacity=".85" /><stop offset="1" stopColor="var(--profile-paper)" stopOpacity=".75" />
      </linearGradient>)}
      <pattern id={`${id}-threads`} width="7" height="300" patternUnits="userSpaceOnUse" patternTransform="skewX(-12)">
        <path d="M1 0V300" stroke="var(--profile-paper)" strokeWidth=".6" strokeOpacity=".14" />
      </pattern>
    </defs>
    {ribbons.map((path, index) => <g key={index} className="fx-aurora-ribbon" data-layer={index}>
      <path d={path} fill={`url(#${id}-ribbon-${index})`} />
      <path d={path} fill={`url(#${id}-threads)`} />
    </g>)}
  </svg>;
}
