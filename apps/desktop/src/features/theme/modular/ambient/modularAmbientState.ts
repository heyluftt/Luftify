import type { MutableRefObject } from "react";
import type { VisualizerFrameSink } from "../../../lyrics/useAmbientVisualizer";

export interface ModularAmbientState {
  sink: VisualizerFrameSink;
  playing: boolean;
  /** How far past each cover edge it reaches, as a share of the cover size. */
  reach: number;
  /** Colour strength, 0 to 2. */
  strength: number;
  /** Spread setting, 0 to 1. */
  spread: number;
}

export type ModularAmbientRef = MutableRefObject<ModularAmbientState>;

export const MODULAR_COLOURS = {
  led: "#45d483",
  ink: "#d8f3e4",
  red: "#f0544f",
  yellow: "#f4c542",
  meterOff: "#1d1f23",
};
