import { useEffect, useRef, useState } from "react";
import { prefersLessMotion } from "../../motion/motionLevel";
import { useStartFrameEmpty } from "../useStartFrameEmpty";
import { startBootScope } from "./bootScope";

const LEAVE_MS = 280;

/** The oscilloscope in the content frame while the start builds the app. */
export function ModularBootScope() {
  const empty = useStartFrameEmpty();
  const [shown, setShown] = useState(empty);
  const [leaving, setLeaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => { if (empty) { setShown(true); setLeaving(false); } }, [empty]);

  useEffect(() => {
    if (empty || !shown) return;
    setLeaving(true);
    const timer = window.setTimeout(() => setShown(false), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [empty, shown]);

  useEffect(() => {
    const element = canvas.current;
    if (!shown || !element || prefersLessMotion()) return;
    const style = getComputedStyle(document.documentElement);
    return startBootScope(element, {
      led: style.getPropertyValue("--md-led").trim() || "#45d483",
      ink: style.getPropertyValue("--md-oled-ink").trim() || "#d8f3e4",
      mute: style.getPropertyValue("--md-mute").trim() || "#8f9298",
    });
  }, [shown]);

  if (!shown) return null;
  return <canvas ref={canvas} className={leaving ? "modular-boot-scope is-leaving" : "modular-boot-scope"} />;
}
