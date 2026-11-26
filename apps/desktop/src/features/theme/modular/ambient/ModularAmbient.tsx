import { useEffect, useRef } from "react";
import type { LyricsVisualSettings } from "../../../../types/tauri";
import type { VisualizerFrameSink } from "../../../lyrics/useAmbientVisualizer";
import { useLessMotion } from "../../../motion/motionLevel";
import { startMeterAmbient } from "./meterAmbient";
import type { ModularAmbientState } from "./modularAmbientState";
import { startScopeAmbient } from "./scopeAmbient";

/** Lichtkranz slot = oscilloscope, Ruhige Wellen slot = level meters */
export function ModularAmbient({ playing, settings, sink }: {
  playing: boolean;
  settings: LyricsVisualSettings;
  sink: VisualizerFrameSink;
}) {
  const meters = settings.mode === "waves";
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useLessMotion();
  const spread = settings.spreadPercent / 100;
  const reach = meters ? 0.22 : 0.48 + spread * 0.22;
  const state = useRef<ModularAmbientState>({ sink, playing, reach, strength: 1, spread });
  state.current = { sink, playing, reach, strength: settings.colorStrengthPercent / 100, spread };

  // motion off draws one frame, so redraw when something in it changes
  const redraw = still ? `${reach}|${settings.colorStrengthPercent}|${spread}|${playing}` : "";

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    return (meters ? startMeterAmbient : startScopeAmbient)(element, state, still);
  }, [meters, still, redraw]);

  return (
    <canvas
      ref={canvas}
      className={meters ? "modular-ambient is-meters" : "modular-ambient is-scope"}
    />
  );
}
