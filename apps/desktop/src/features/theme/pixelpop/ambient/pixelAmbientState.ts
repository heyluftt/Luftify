import type { MutableRefObject } from "react";
import type { VisualizerFrameSink } from "../../../lyrics/useAmbientVisualizer";
import { readAmbientLevels, type AmbientLevels } from "../../../lyrics/selfDrawnAmbient";

export { ambientAlpha, runAmbientLoop } from "../../../lyrics/selfDrawnAmbient";

export interface PixelAmbientColors {
  base: string;
  mid: string;
  tip: string;
  cap: string;
}

export interface PixelAmbientState {
  sink: VisualizerFrameSink;
  playing: boolean;
  /** How far past each cover edge it reaches, as a share of the cover size. */
  reach: number;
  /** Colour strength, 0 to 2. */
  strength: number;
  colors: PixelAmbientColors;
  /** The cover as a small grid of RGBA colours (mosaic only). */
  cover?: Uint8ClampedArray;
}

export type PixelAmbientRef = MutableRefObject<PixelAmbientState>;

export function readLevels(state: PixelAmbientState, now: number): AmbientLevels {
  return readAmbientLevels(state.sink, state.playing, now);
}
