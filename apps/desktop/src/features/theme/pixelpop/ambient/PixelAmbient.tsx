import { useEffect, useRef } from "react";
import type { LyricsVisualSettings } from "../../../../types/tauri";
import type { VisualizerFrameSink } from "../../../lyrics/useAmbientVisualizer";
import { useLessMotion } from "../../../motion/motionLevel";
import { useArtworkPalette } from "../../useCoverTint";
import type { PixelAmbientState } from "./pixelAmbientState";
import { startPixelEqualizer } from "./pixelEqualizer";
import { MOSAIC_TILES, startPixelMosaic } from "./pixelMosaic";
import { usePixelCover } from "./usePixelCover";

const CREAM = "#f6eedb";
/** Below this the cover is too grey to colour the effect; the theme's own colours step in. */
const DULL = 0.12;

/**
 * Pixelpop's own ambients in the lyrics view. They take the two stored
 * slots: „Lichtkranz“ becomes the equalizer, „Ruhige Wellen“ the mosaic.
 */
export function PixelAmbient({ image, playing, settings, sink }: {
  image: string | undefined;
  playing: boolean;
  settings: LyricsVisualSettings;
  sink: VisualizerFrameSink;
}) {
  const mosaic = settings.mode === "waves";
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useLessMotion();
  const palette = useArtworkPalette(image);
  const cover = usePixelCover(mosaic ? image : undefined, MOSAIC_TILES);
  const spread = settings.spreadPercent / 100;
  const reach = mosaic ? 0.3 + spread * 0.4 : 0.22 + spread * 0.33;
  const vivid = palette && palette.vividness >= DULL ? palette : undefined;
  const [first, second, third] = vivid?.pigments ?? [];
  const state = useRef<PixelAmbientState>({ sink, playing, reach, strength: 1, colors: { base: CREAM, mid: CREAM, tip: CREAM, cap: CREAM } });
  state.current = {
    sink,
    playing,
    reach,
    strength: settings.colorStrengthPercent / 100,
    colors: {
      base: second ?? vivid?.primary ?? "#47407a",
      mid: first ?? vivid?.secondary ?? "#ff6b5b",
      tip: third ?? vivid?.highlight ?? "#ffc94a",
      cap: CREAM,
    },
    ...(cover ? { cover } : {}),
  };

  // motion off draws one frame, so redraw when something in it changes
  const { colors } = state.current;
  const redraw = still ? `${colors.base}|${colors.mid}|${colors.tip}|${reach}|${settings.colorStrengthPercent}|${playing}` : "";
  const redrawCover = still ? cover : undefined;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    return (mosaic ? startPixelMosaic : startPixelEqualizer)(element, state, still);
  }, [mosaic, still, redraw, redrawCover]);

  return (
    <canvas
      ref={canvas}
      className={mosaic ? "pixel-ambient is-mosaic" : "pixel-ambient is-equalizer"}
    />
  );
}
