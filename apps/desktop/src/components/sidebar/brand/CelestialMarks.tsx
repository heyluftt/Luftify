import { OrbitTrack, type BrandPaint } from "./OrbitTrack";

const VIOLET_ORBIT = "M58 32a26 17 0 1 1-52 0a26 17 0 1 1 52 0";

export function CelestialMarks({ paint }: { paint: BrandPaint }) {
  return <>
    <g className="brand-mark-variant brand-mark-violet">
      <circle cx="32" cy="32" r="15" fill={paint("aura")} />
      <g transform="rotate(38 32 32)"><OrbitTrack d={VIOLET_ORBIT} paint={paint} period={1.4} phase={.55} small /></g>
      <circle cx="32" cy="32" r="10.5" fill={paint("orb")} stroke={paint("rim")} strokeWidth=".6" />
      <path d="M27 30v4M32 26v12M37 29v6" className="brand-orbit-glint" />
      <path d="M26 26a9 9 0 0 1 8-3" stroke="var(--brand-light)" strokeWidth=".65" opacity=".6" />
      <g transform="rotate(-38 32 32)"><OrbitTrack d={VIOLET_ORBIT} paint={paint} phase={.12} /></g>
    </g>
    <g className="brand-mark-variant brand-mark-polaris">
      <path d="m11 43 10-9 18 12 15-22M21 34l7-19 26 9" stroke={paint("rim")} strokeWidth=".7" opacity=".6" />
      {[[11, 43], [21, 34], [39, 46], [54, 24], [28, 15]].map(([x, y], i) =>
        <circle key={i} cx={x} cy={y} r={i % 2 ? 1.1 : 1.5} fill="var(--brand-secondary)" />)}
      <g transform="rotate(-20 32 32)"><OrbitTrack d="M59 32a27 19 0 1 1-54 0a27 19 0 1 1 54 0" paint={paint} small phase={.3} /></g>
      <g className="brand-polaris-star brand-motion">
        <path d="m32 10 4 17 13 5-13 5-4 17-4-17-13-5 13-5Z" fill={paint("glass")} />
        <path d="m32 16 2 14 9 2-9 2-2 14-2-14-9-2 9-2Z" fill="var(--brand-light)" />
        <path d="m20 20 9 9m6 6 9 9m0-24-9 9m-6 6-9 9" stroke={paint("rim")} strokeWidth=".65" />
        <circle cx="32" cy="32" r="2" fill="var(--brand-secondary)" />
      </g>
    </g>
  </>;
}
