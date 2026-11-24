import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";

import { START_PARTS, type StartPart } from "./useStartFlow";

const REGIONS = ".sidebar, .content-shell, .playerbar";

/**
 * Marks the document while the start runs: `data-start` turns the app into
 * its outline and `data-start-<part>` lets a region appear
 * (styles/components/start-flow.css).
 */
export function useStartSurface(active: boolean, shown: readonly StartPart[], setup: boolean): void {
  // Before the first paint, so the finished app never flashes up.
  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.setAttribute("data-start", "");
    return () => {
      root.removeAttribute("data-start");
      root.removeAttribute("data-start-setup");
      START_PARTS.forEach((part) => root.removeAttribute(`data-start-${part}`));
    };
  }, [active]);

  useLayoutEffect(() => {
    if (active) document.documentElement.toggleAttribute("data-start-setup", setup);
  }, [active, setup]);

  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    START_PARTS.forEach((part) => root.toggleAttribute(`data-start-${part}`, shown.includes(part)));
  }, [active, shown]);

  // Nothing behind the start can be clicked or tabbed into.
  useEffect(() => {
    if (!active) return;
    const regions = [...document.querySelectorAll<HTMLElement>(REGIONS)];
    regions.forEach((region) => { region.inert = true; });
    return () => regions.forEach((region) => { region.inert = false; });
  }, [active]);
}

/** Where the search bar sits, so the loading indicator can take exactly its place. */
export function useSearchSlot(active: boolean): CSSProperties {
  const [slot, setSlot] = useState<DOMRect | undefined>(undefined);

  useLayoutEffect(() => {
    if (!active) return;
    const search = document.querySelector(".global-search");
    const measure = () => setSlot(search?.getBoundingClientRect());
    measure();
    window.addEventListener("resize", measure);
    // The search bar also moves while fonts and the sidebar settle.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    for (const element of [search, document.querySelector(".content-shell")]) {
      if (element) observer?.observe(element);
    }
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [active]);

  if (!slot || slot.width === 0) return {};
  return {
    "--start-x": `${slot.left}px`,
    "--start-y": `${slot.top}px`,
    "--start-w": `${slot.width}px`,
    "--start-h": `${slot.height}px`,
  } as CSSProperties;
}
