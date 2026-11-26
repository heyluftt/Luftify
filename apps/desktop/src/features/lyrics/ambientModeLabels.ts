import type { MessageKey } from "../../i18n";

type AmbientLabels = Record<"pulse" | "waves" | "pulseOn" | "wavesOn" | "pulseFollow" | "wavesFollow" | "hint", MessageKey>;

const MODULAR: AmbientLabels = {
  pulse: "settings.lyricsView.modularScope",
  waves: "settings.lyricsView.modularMeters",
  pulseOn: "settings.lyricsView.modularScopeOn",
  wavesOn: "settings.lyricsView.modularMetersOn",
  pulseFollow: "settings.lyricsView.modularScopeFollow",
  wavesFollow: "settings.lyricsView.modularMetersFollow",
  hint: "settings.lyricsView.modularHint",
};

/** Pixelpop and Modular draw their own two ambients in the same two slots, with own names. */
export function ambientModeLabels(themeId: string | undefined) {
  if (themeId === "luft.modular") return MODULAR;
  const pixel = themeId === "luft.pixelpop";
  const labels: AmbientLabels = pixel
    ? {
        pulse: "settings.lyricsView.pixelEqualizer",
        waves: "settings.lyricsView.pixelMosaic",
        pulseOn: "settings.lyricsView.pixelEqualizerOn",
        wavesOn: "settings.lyricsView.pixelMosaicOn",
        pulseFollow: "settings.lyricsView.pixelEqualizerFollow",
        wavesFollow: "settings.lyricsView.pixelMosaicFollow",
        hint: "settings.lyricsView.pixelHint",
      }
    : {
        pulse: "settings.lyricsView.pulse",
        waves: "settings.lyricsView.waves",
        pulseOn: "settings.lyricsView.pulseOn",
        wavesOn: "settings.lyricsView.wavesOn",
        pulseFollow: "settings.lyricsView.pulseFollow",
        wavesFollow: "settings.lyricsView.wavesFollow",
        hint: "settings.lyricsView.visualizerHint",
      };
  return labels;
}
