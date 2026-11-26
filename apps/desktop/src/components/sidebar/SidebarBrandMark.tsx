import { useEffect, useId, useState } from "react";
import { AerisBrandMark } from "../../features/theme/aeris/AerisBrandMark";
import { PixelpopBrandMark } from "../../features/theme/pixelpop/PixelpopBrandMark";
import { ModularBrandMark } from "../../features/theme/modular/ModularBrandMark";
import { ClassicMarks } from "./brand/ClassicMarks";
import { CelestialMarks } from "./brand/CelestialMarks";
import { MaterialMarks } from "./brand/MaterialMarks";
import { OrganicMarks } from "./brand/OrganicMarks";

/** Theme sculptures with CSS motion; background tabs freeze every detail. */
export function SidebarBrandMark() {
  const id = `brand-${useId().replaceAll(":", "")}`;
  const paint = (name: string) => `url(#${id}-${name})`;
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return (
    <svg className="sidebar-brand-orbit" data-paused={hidden || undefined} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-orb`} cx=".3" cy=".24" r=".82">
          <stop stopColor="var(--brand-light)" />
          <stop offset=".38" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--brand-depth)" />
        </radialGradient>
        <linearGradient id={`${id}-glass`} x1="12" y1="10" x2="48" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand-light)" stopOpacity=".9" />
          <stop offset=".48" stopColor="var(--accent)" stopOpacity=".62" />
          <stop offset="1" stopColor="var(--brand-depth)" stopOpacity=".9" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="10" y1="6" x2="53" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand-light)" stopOpacity=".85" />
          <stop offset=".5" stopColor="var(--accent)" stopOpacity=".22" />
          <stop offset="1" stopColor="var(--brand-secondary)" stopOpacity=".72" />
        </linearGradient>
        <radialGradient id={`${id}-aura`}>
          <stop stopColor="var(--accent)" stopOpacity=".2" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="brand-orbit-aura" cx="32" cy="32" r="31" fill={paint("aura")} />
      <ClassicMarks paint={paint} />
      <CelestialMarks paint={paint} />
      <MaterialMarks paint={paint} />
      <OrganicMarks paint={paint} />
      <AerisBrandMark paint={paint} />
      <PixelpopBrandMark />
      <ModularBrandMark />
    </svg>
  );
}
