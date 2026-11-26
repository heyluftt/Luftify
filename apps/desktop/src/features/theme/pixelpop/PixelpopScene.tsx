import { useEffect, useRef } from "react";
import { useLessMotion } from "../../motion/motionLevel";
import { useActiveTheme } from "../useActiveTheme";
import { PixelpopBootLogo } from "./PixelpopBootLogo";
import { PixelpopFilters } from "./PixelpopFilters";
import { startPixelSky } from "./pixelSky";
import { usePixelIris } from "./usePixelIris";
import { usePixelPulse } from "./usePixelPulse";
import { usePixelSwitch } from "./usePixelSwitch";

const THEME_ID = "luft.pixelpop";

/** Pixelpop behind the content: night sky, iris between pages, start logo. */
export function PixelpopScene() {
  const active = useActiveTheme() === THEME_ID;
  const still = useLessMotion();
  const scene = useRef<HTMLDivElement>(null);
  const sky = useRef<HTMLCanvasElement>(null);

  usePixelSwitch(THEME_ID, active);
  usePixelPulse(active);
  usePixelIris(active && !still);

  useEffect(() => {
    if (!active || !sky.current || !scene.current) return;
    return startPixelSky(sky.current, scene.current);
  }, [active, still]);

  if (!active) return null;
  return (
    <div ref={scene} className="pixelpop-scene" aria-hidden="true">
      <canvas ref={sky} className="pixelpop-sky" />
      <PixelpopBootLogo />
      <PixelpopFilters />
    </div>
  );
}
