import { useEffect, useRef, useState } from "react";
import { prefersLessMotion } from "../../motion/motionLevel";
import { useStartFrameEmpty } from "../useStartFrameEmpty";
import { startPixelLogo } from "./pixelLogo";
import { readPixelPalette } from "./pixelPalette";

/** The falling „LUFTIFY“ inside the content frame during the start. */
export function PixelpopBootLogo() {
  const empty = useStartFrameEmpty();
  const [shown, setShown] = useState(empty);
  const canvas = useRef<HTMLCanvasElement>(null);
  const logo = useRef<ReturnType<typeof startPixelLogo> | undefined>(undefined);

  useEffect(() => { if (empty) setShown(true); }, [empty]);

  useEffect(() => {
    const element = canvas.current;
    if (!shown || !element || prefersLessMotion()) return;
    logo.current = startPixelLogo(element, readPixelPalette(element));
    return () => {
      logo.current?.stop();
      logo.current = undefined;
    };
  }, [shown]);

  useEffect(() => {
    if (empty || !shown) return;
    if (!logo.current) { setShown(false); return; }
    void logo.current.clear().then(() => setShown(false));
  }, [empty, shown]);

  if (!shown) return null;
  return <canvas ref={canvas} className="pixelpop-logo" />;
}
