/** Three swept sails form a small kinetic wind sculpture. */
export function AerisBrandMark({ paint }: { paint: (name: string) => string }) {
  return <g className="brand-mark-variant brand-mark-aeris">
    <path d="M12 18a25 25 0 0 1 38-3M52 45a25 25 0 0 1-38 3" stroke={paint("rim")} strokeWidth=".8" />
    <circle cx="32" cy="32" r="23" stroke={paint("rim")} strokeWidth=".55" strokeDasharray="1 5" opacity=".5" />
    <g className="brand-aeris-sails">
      {[0, 120, 240].map(angle => <g key={angle} transform={`rotate(${angle} 32 32)`}>
        <path d="M31 30C19 28 15 17 23 9c-1 10 6 11 14 11 7 0 12 5 12 11-5-5-10-6-18-1Z" fill={paint("glass")} stroke={paint("rim")} strokeWidth=".55" />
        <path d="M23 9C20 25 36 20 45 27" stroke="var(--brand-light)" strokeWidth=".8" opacity=".7" />
        <path d="M31 30c4-5 9-5 14-3" stroke="var(--brand-secondary)" strokeWidth=".7" />
      </g>)}
    </g>
    <circle cx="32" cy="32" r="5" fill={paint("orb")} stroke={paint("rim")} strokeWidth=".8" />
    <circle cx="31" cy="31" r="1" fill="var(--brand-light)" />
  </g>;
}
