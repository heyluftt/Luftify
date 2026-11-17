import { useId } from "react";

/** Sweeping optical glass: the cover's colors split along its edges like a prism. */
export function PrismaGlassField() {
  const id = `prisma-glass-${useId().replaceAll(":", "")}`;
  const paint = (name: string) => `url(#${id}-${name})`;
  return (
    <svg className="prisma-glass-field" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-body`} x1="610" y1="110" x2="850" y2="900" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--scene-pigment-1)" stopOpacity="0" />
          <stop offset=".24" stopColor="var(--scene-pigment-1)" stopOpacity=".24" />
          <stop offset=".52" stopColor="var(--scene-light)" stopOpacity=".08" />
          <stop offset=".8" stopColor="var(--scene-pigment-2)" stopOpacity=".26" />
          <stop offset="1" stopColor="var(--scene-pigment-2)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-fold`} x1="630" y1="230" x2="880" y2="830" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--scene-light)" stopOpacity="0" />
          <stop offset=".35" stopColor="var(--scene-pigment-1)" stopOpacity=".34" />
          <stop offset=".53" stopColor="var(--scene-light)" stopOpacity=".18" />
          <stop offset=".7" stopColor="var(--scene-pigment-3)" stopOpacity=".3" />
          <stop offset="1" stopColor="var(--scene-pigment-3)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="650" y1="60" x2="660" y2="950" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--scene-light)" stopOpacity="0" />
          <stop offset=".29" stopColor="var(--scene-pigment-1)" stopOpacity=".6" />
          <stop offset=".52" stopColor="var(--scene-light)" stopOpacity=".5" />
          <stop offset=".78" stopColor="var(--scene-pigment-2)" stopOpacity=".44" />
          <stop offset="1" stopColor="var(--scene-light)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-caustic`}>
          <stop stopColor="var(--scene-pigment-1)" stopOpacity=".3" />
          <stop offset="1" stopColor="var(--scene-pigment-1)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="790" cy="370" rx="240" ry="320" transform="rotate(-28 790 370)" fill={paint("caustic")} />
      <path d="M990-140C708 50 390 140 526 365c100 164 440 156 365 382-55 168-345 224-299 393h568V-140Z" fill={paint("body")} />
      <path d="M1070-130C814 53 468 156 615 374c112 168 414 158 333 384-56 155-300 226-243 382h-113c-46-169 244-225 299-393 75-226-265-218-365-382C390 140 708 50 990-140Z" fill={paint("fold")} />
      <path d="M990-140C708 50 390 140 526 365c100 164 440 156 365 382-55 168-345 224-299 393" stroke={paint("edge")} strokeWidth="1.3" />
      <path d="M1070-130C814 53 468 156 615 374c112 168 414 158 333 384-56 155-300 226-243 382" stroke={paint("edge")} strokeWidth=".7" opacity=".6" />
      <path d="M941-80C700 95 433 185 568 374c103 144 410 144 336 365" stroke={paint("edge")} strokeWidth="16" opacity=".1" />
    </svg>
  );
}
