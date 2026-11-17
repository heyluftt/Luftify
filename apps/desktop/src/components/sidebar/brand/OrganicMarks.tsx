import { OrbitTrack, ROUND_TRACK, type BrandPaint } from "./OrbitTrack";

export function OrganicMarks({ paint }: { paint: BrandPaint }) {
  return <>
    <g className="brand-mark-variant brand-mark-redline">
      <OrbitTrack d="M19 9H45L58 32 45 55H19L6 32Z" paint={paint} phase={.2} small />
      <path d="M21 14h10m12 36H33M11 30l4-7M53 34l-4 7" className="brand-orbit-engraving" />
      <g className="brand-redline-flame brand-motion">
        <path d="M34 16c1 9 12 13 10 23-1 7-7 11-13 10-8-1-13-7-11-14 1-4 4-7 8-12-1 6 0 9 3 10 4-4 4-9 3-17Z" fill={paint("orb")} />
        <path d="M32 31c-2 6-7 8-5 12 2 4 9 4 11-1 1-3-2-7-6-11Z" fill="var(--brand-secondary)" />
        <path d="M29 42c0-3 2-4 3-7 3 3 5 8 0 10" fill="var(--brand-light)" fillOpacity=".65" />
      </g>
      <g className="brand-redline-ember brand-motion"><circle cx="39" cy="19" r="1" fill="var(--brand-secondary)" /></g>
    </g>
    <g className="brand-mark-variant brand-mark-abyss">
      <path d="M14 20a24 24 0 0 1 39 22M10 39a24 24 0 0 0 34 16" stroke={paint("rim")} strokeWidth=".65" />
      <g className="brand-abyss-jelly brand-motion">
        <g className="brand-abyss-bell brand-motion">
          <path d="M17 31c0-10 7-17 15-17s15 7 15 17c-4 3-7 2-10 0-3 3-7 3-10 0-3 2-6 3-10 0Z" fill={paint("orb")} stroke={paint("rim")} strokeWidth=".65" />
          <path d="M23 27c0-5 4-9 9-9m0 1c5 0 9 4 9 9" className="brand-orbit-glint" />
          <path d="M20 30c8-3 16-3 24 0" stroke="var(--brand-secondary)" strokeWidth="1" opacity=".7" />
        </g>
        <g className="brand-abyss-tentacles brand-motion">
          <path d="M22 34c-3 8 4 11-1 18M28 35c-2 7 4 10 1 20M35 35c2 7-4 10-1 20M42 34c3 8-4 11 1 18" stroke={paint("rim")} strokeWidth="1.1" strokeLinecap="round" />
          <path d="M31 35c-1 6 2 10 0 16" stroke="var(--brand-secondary)" strokeWidth=".7" opacity=".6" />
        </g>
      </g>
      <g className="brand-abyss-plankton brand-motion"><circle cx="52" cy="37" r="1.3" fill="var(--brand-secondary)" /><circle cx="12" cy="49" r="1" fill="var(--brand-light)" /></g>
    </g>
    <g className="brand-mark-variant brand-mark-rose">
      <OrbitTrack d={ROUND_TRACK} paint={paint} small phase={.35} />
      <g className="brand-rose-bloom brand-motion">
        {[0, 60, 120, 180, 240, 300].map(angle => <g key={angle} transform={`rotate(${angle} 32 32)`}>
          <path d="M32 32C18 27 21 12 32 13c9 1 11 12 0 19Z" fill={paint("glass")} fillOpacity=".65" stroke={paint("rim")} strokeWidth=".65" />
          <path d="M32 16c-3 4-3 10 0 16" stroke="var(--brand-light)" strokeWidth=".55" opacity=".6" />
        </g>)}
        <circle cx="32" cy="32" r="6" fill={paint("orb")} stroke={paint("rim")} strokeWidth=".7" />
        <path d="M29 29a4 4 0 0 1 4-1" className="brand-orbit-glint" />
      </g>
    </g>
  </>;
}
