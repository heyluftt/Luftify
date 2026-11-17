import { OrbitTrack, ROUND_TRACK, type BrandPaint } from "./OrbitTrack";

/** Quiet metalwork for the three neutral themes. */
export function ClassicMarks({ paint }: { paint: BrandPaint }) {
  return <>
    <g className="brand-mark-variant brand-mark-dark">
      <circle cx="32" cy="32" r="26" stroke={paint("rim")} strokeWidth=".55" opacity=".4" />
      <circle cx="32" cy="32" r="14" fill={paint("orb")} />
      <path d="M23 28c2-5 6-7 11-6" className="brand-orbit-glint" />
      <path d="M20 35c7 5 18 5 25-1" stroke="var(--brand-depth)" strokeWidth="2" opacity=".6" />
      <g transform="rotate(-28 32 32)">
        <OrbitTrack d="M59 32a27 10 0 1 1-54 0a27 10 0 1 1 54 0" paint={paint} />
      </g>
    </g>
    <g className="brand-mark-variant brand-mark-light">
      <OrbitTrack d={ROUND_TRACK} paint={paint} small />
      <circle cx="32" cy="32" r="20" stroke={paint("rim")} strokeWidth=".65" />
      <g className="brand-light-iris brand-motion">
        {[0, 60, 120, 180, 240, 300].map(angle => <path key={angle} transform={`rotate(${angle} 32 32)`}
          d="M32 15c9 0 17 8 17 17l-11-6Z" fill={paint("glass")} fillOpacity=".48" stroke={paint("rim")} strokeWidth=".6" />)}
      </g>
      <circle cx="32" cy="32" r="7.5" fill={paint("orb")} />
      <circle cx="30" cy="30" r="1.5" fill="var(--brand-light)" />
    </g>
    <g className="brand-mark-variant brand-mark-atelier">
      <OrbitTrack d={ROUND_TRACK} paint={paint} period={1.25} small phase={.15} />
      <circle cx="32" cy="32" r="21" stroke={paint("rim")} strokeWidth=".8" strokeDasharray=".8 4.7" />
      <path d="M32 7v7M32 50v7M7 32h7M50 32h7" className="brand-orbit-engraving" />
      <g className="brand-atelier-needle brand-motion">
        <path d="M32 14 37 29 50 32 37 35 32 50 27 35 14 32 27 29Z" fill={paint("glass")} stroke={paint("rim")} strokeWidth=".6" />
        <path d="m32 14 5 15-5 3Z" fill="var(--brand-light)" />
        <path d="m32 50-5-15 5-3Z" fill="var(--brand-depth)" />
      </g>
      <circle cx="32" cy="32" r="3" fill={paint("orb")} stroke="var(--brand-light)" strokeWidth=".7" />
    </g>
  </>;
}
