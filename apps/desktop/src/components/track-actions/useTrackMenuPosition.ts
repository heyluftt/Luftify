import { useLayoutEffect, useState, type RefObject } from "react";

/** Keep the measured menu near the click, including when a submenu changes its size. */
export function useTrackMenuPosition(
  menu: RefObject<HTMLDivElement | null>,
  { x, y }: { x: number; y: number },
) {
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const place = () => {
      const margin = 12;
      const left = Math.max(margin, Math.min(x, window.innerWidth - element.offsetWidth - margin));
      const top = Math.max(margin, Math.min(y, window.innerHeight - element.offsetHeight - margin));
      setPosition(current => current.left === left && current.top === top ? current : { left, top });
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(element);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [menu, x, y]);
  return position;
}
