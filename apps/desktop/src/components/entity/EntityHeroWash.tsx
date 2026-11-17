import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/** Share the cover wash with the topbar instead of clipping it inside the scroller. */
export function EntityHeroWash({ tint }: { tint: CSSProperties | undefined }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const wash = useRef<HTMLSpanElement>(null);
  const [surface, setSurface] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setSurface(anchor.current?.closest<HTMLElement>(".content-shell") ?? null);
  }, []);

  useLayoutEffect(() => {
    const scroller = surface?.querySelector<HTMLElement>(".page-scroll");
    const element = wash.current;
    if (!scroller || !element) return;
    const update = () => {
      element.style.setProperty("--entity-wash-opacity", String(Math.max(0, 1 - scroller.scrollTop / 460)));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, [surface]);

  const layer = <span ref={wash}
    className={`entity-hero-wash${tint ? " is-tinted" : ""}${surface ? " is-shared" : ""}`}
    style={tint} aria-hidden="true" />;
  return <><span ref={anchor} hidden aria-hidden="true" />{surface ? createPortal(layer, surface) : layer}</>;
}
