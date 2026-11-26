import { useEffect, useRef } from "react";
import { useThemeArrival } from "../useThemeArrival";
import { pixelReveal } from "./pixelDissolve";
import { readPixelPalette } from "./pixelPalette";

/** Switching to Pixelpop: blocks wipe down the window once. */
export function usePixelSwitch(themeId: string, active: boolean) {
  const cancel = useRef<(() => void) | undefined>(undefined);

  useThemeArrival(themeId, (level) => {
    cancel.current?.();
    cancel.current = pixelReveal(readPixelPalette(document.documentElement), level === "subtle" ? 5 : 9);
  });

  useEffect(() => {
    if (active) return;
    cancel.current?.();
    cancel.current = undefined;
  }, [active]);
}
