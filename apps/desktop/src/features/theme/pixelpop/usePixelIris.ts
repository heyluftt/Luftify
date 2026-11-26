import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { motionLevel } from "../../motion/motionLevel";
import { pixelIris } from "./pixelIris";
import { readPixelPalette } from "./pixelPalette";

/** A click this recent caused the page change; older ones did not. */
const CLICK_MS = 1_500;

/** On every page change a pixel circle opens from where you clicked. */
export function usePixelIris(enabled: boolean) {
  const { pathname } = useLocation();
  const shown = useRef(pathname);
  const click = useRef<{ x: number; y: number; at: number } | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const remember = (event: PointerEvent) => { click.current = { x: event.clientX, y: event.clientY, at: performance.now() }; };
    document.addEventListener("pointerdown", remember, { capture: true, passive: true });
    return () => document.removeEventListener("pointerdown", remember, { capture: true });
  }, [enabled]);

  useLayoutEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    const level = motionLevel();
    if (!enabled || level === "off" || document.documentElement.hasAttribute("data-start")) return;
    const page = document.querySelector<HTMLElement>(".page-scroll");
    if (!page) return;
    const area = page.getBoundingClientRect();
    const recent = click.current && performance.now() - click.current.at < CLICK_MS ? click.current : undefined;
    // keyboard, palette or history: from the middle
    const from = recent ?? { x: area.left + area.width / 2, y: area.top + area.height / 3 };
    return pixelIris(area, from, readPixelPalette(page), level === "subtle" ? 5 : 9);
  }, [enabled, pathname]);
}
