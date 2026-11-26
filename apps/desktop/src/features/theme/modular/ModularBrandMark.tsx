/** A tiny module: screws, a trace, a jack and a LED that keeps time. */
export function ModularBrandMark() {
  return (
    <g className="brand-mark-variant brand-mark-modular">
      <rect x="11" y="7" width="42" height="50" rx="3" fill="#1c1e22" stroke="#34373c" strokeWidth="1" />
      {[[15, 11], [49, 11], [15, 53], [49, 53]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" fill="#4a4e55" />)}
      <path d="M16 31h5l3-9 4 17 4-13 3 7 3-3h7" fill="none" stroke="var(--md-oled-ink, #d8f3e4)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23" cy="45" r="4.6" fill="#030303" stroke="#a3a6ab" strokeWidth="1.4" />
      <circle className="brand-md-led" cx="44" cy="18" r="2.8" fill="var(--md-led, #45d483)" />
    </g>
  );
}
