import { useEffect, useRef, useState } from "react";
import { AerisWindField } from "./AerisWindField";
import { startAerisWind } from "./aerisWind";

/**
 * Theme „Aeris“: wind behind the content canvas (shell/atmosphere.css).
 * Mist drifts, silk sheets lift and settle, and thin streaks follow the
 * wind on a canvas (aerisWind.ts), with a gust now and then.
 */
export function AerisScene() {
  const [active, setActive] = useState(() => document.documentElement.dataset.theme === "luft.aeris");
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  const streams = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setActive(root.dataset.theme === "luft.aeris");
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!active) return;
    const sync = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => document.removeEventListener("visibilitychange", sync);
  }, [active]);
  useEffect(() => {
    if (!active || !streams.current) return;
    return startAerisWind(streams.current);
  }, [active]);
  if (!active) return null;
  return <div className="aeris-scene" data-paused={hidden || undefined} aria-hidden="true">
    <div className="aeris-daylight" />
    <div className="aeris-cloud aeris-cloud-near" />
    <div className="aeris-cloud aeris-cloud-far" />
    <AerisWindField />
    <div className="aeris-reading-veil" />
    <canvas ref={streams} className="aeris-streams" />
  </div>;
}
