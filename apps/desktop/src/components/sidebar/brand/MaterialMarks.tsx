import { OrbitTrack, type BrandPaint } from "./OrbitTrack";

export function MaterialMarks({ paint }: { paint: BrandPaint }) {
  return <>
    <g className="brand-mark-variant brand-mark-prisma">
      <path d="M4 36 25 33m18 2 17 8m-17-8 17 2m-17-2 17-4" className="brand-orbit-engraving" />
      <g className="brand-prisma-crystal brand-motion">
        <path d="m31 8 23 37-19 12L11 43Z" fill={paint("glass")} stroke={paint("rim")} strokeWidth=".9" />
        <path d="m31 8 4 25 19 12-19 12Z" fill="var(--brand-secondary)" fillOpacity=".5" />
        <path d="m31 8 4 25-24 10Z" fill="var(--brand-light)" fillOpacity=".22" />
        <path d="m31 8 4 25-24 10m24-10 19 12-19 12V33" className="brand-orbit-glint" />
        <OrbitTrack d="M31 8 54 45 35 57 11 43Z" paint={paint} small phase={.1} />
      </g>
    </g>
    <g className="brand-mark-variant brand-mark-calamus">
      <OrbitTrack d="M16 9H48L55 16V48L48 55H16L9 48V16Z" paint={paint} small phase={.1} />
      <path d="M17 16h-1v9M47 16h1v9M16 39v9h9M39 48h9v-9M32 9v5M32 50v5M9 32h5M50 32h5" className="brand-orbit-engraving" />
      <g className="brand-calamus-nib brand-motion">
        <path d="M32 15 44 30 36 45h-8l-8-15Z" fill={paint("glass")} stroke={paint("rim")} strokeWidth=".9" />
        <path d="M32 15v21l-4 9m4-9 4 9" className="brand-orbit-glint" />
        <path d="m32 15 12 15-12 6Z" fill="var(--brand-light)" fillOpacity=".16" />
        <circle cx="32" cy="33" r="2" fill="var(--brand-depth)" stroke="var(--brand-light)" strokeWidth=".65" />
      </g>
    </g>
  </>;
}
