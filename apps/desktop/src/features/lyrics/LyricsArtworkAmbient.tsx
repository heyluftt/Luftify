import { useRef, type CSSProperties } from "react";

import { AlbumArt } from "../../components/AlbumArt";
import type { LyricsVisualSettings } from "../../types/tauri";
import {
  lyricsAmbientMetrics,
  normalizeLyricsVisualSettings,
} from "./lyricsVisualSettings";
import { LyricsHalo } from "./LyricsHalo";
import { useAmbientVisualizer, type VisualizerFrameSink } from "./useAmbientVisualizer";
import { useActiveTheme } from "../theme/useActiveTheme";
import { PixelAmbient } from "../theme/pixelpop/ambient/PixelAmbient";
import { ModularAmbient } from "../theme/modular/ambient/ModularAmbient";

interface LyricsArtworkAmbientProps {
  image: string | undefined;
  playing: boolean;
  settings: LyricsVisualSettings;
  title: string;
}

type AmbientStyle = CSSProperties & Record<`--lyrics-${string}`, string>;

export function LyricsArtworkAmbient({
  image,
  playing,
  settings,
  title,
}: LyricsArtworkAmbientProps) {
  const normalized = normalizeLyricsVisualSettings(settings);
  const waves = normalized.mode === "waves";
  const ambientRef = useRef<HTMLDivElement>(null);
  const theme = useActiveTheme();
  const pixel = theme === "luft.pixelpop";
  const modular = theme === "luft.modular";
  const selfDrawn = pixel || modular;
  const frames: VisualizerFrameSink = useRef(undefined);
  const visualizerActive = useAmbientVisualizer({
    enabled: normalized.enabled && normalized.visualizerEnabled,
    playing,
    mode: normalized.mode,
    spreadPercent: normalized.spreadPercent,
    colorStrengthPercent: normalized.colorStrengthPercent,
    sensitivityPercent: normalized.visualizerSensitivityPercent,
    target: ambientRef,
    ...(selfDrawn ? { frameSink: frames } : {}),
  });

  return (
    <>
      <div className="lyrics-artwork-glow" aria-hidden="true">
        <AlbumArt
          title={title}
          size="feature"
          image={image}
        />
      </div>

      {normalized.enabled && (
        <div
          ref={ambientRef}
          className={`lyrics-artwork-ambient mode-${normalized.mode}${playing ? " is-playing" : ""}${visualizerActive ? " is-visualizer" : ""}${pixel ? " is-pixel" : ""}${modular ? " is-modular" : ""}`}
          style={ambientStyle(normalized)}
          aria-hidden="true"
        >
          {pixel ? (
            <PixelAmbient image={image} playing={playing} settings={normalized} sink={frames} />
          ) : modular ? (
            <ModularAmbient playing={playing} settings={normalized} sink={frames} />
          ) : waves ? (
            <>
              <div className="lyrics-artwork-pulse">
                <div className="lyrics-artwork-ambient-source">
                  <AlbumArt title={title} size="feature" image={image} />
                </div>
              </div>
              <div className="lyrics-artwork-waves">
                <div className="lyrics-artwork-wave-ribbon ribbon-one" />
                <div className="lyrics-artwork-wave-ribbon ribbon-two" />
                <div className="lyrics-artwork-wave-ribbon ribbon-three" />
                <div className="lyrics-artwork-wave wave-one">
                  <div className="lyrics-artwork-ambient-source">
                    <AlbumArt title={title} size="feature" image={image} />
                  </div>
                </div>
                <div className="lyrics-artwork-wave wave-two">
                  <div className="lyrics-artwork-ambient-source">
                    <AlbumArt title={title} size="feature" image={image} />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <LyricsHalo image={image} />
          )}
        </div>
      )}
    </>
  );
}

function ambientStyle(settings: LyricsVisualSettings): AmbientStyle {
  const metrics = lyricsAmbientMetrics(settings);
  if (settings.mode !== "waves") {
    return {
      "--lyrics-beam-far-reach": `${metrics.beamFarReachPx}px`,
      "--lyrics-beam-opacity": String(metrics.beamOpacity),
      "--lyrics-beam-turn-time": `${metrics.beamTurnSeconds}s`,
      "--lyrics-beam-width": `${metrics.beamWidthPx}px`,
      "--lyrics-halo-blur": `${metrics.haloBlurPx}px`,
      "--lyrics-halo-max-opacity": String(metrics.haloMaxOpacity),
      "--lyrics-halo-min-opacity": String(metrics.haloMinOpacity),
      "--lyrics-halo-reach": `${metrics.haloReachPercent}%`,
      "--lyrics-halo-rest-opacity": String(metrics.haloRestOpacity),
      "--lyrics-halo-saturation": String(metrics.haloSaturation),
      "--lyrics-halo-swell": String(metrics.haloSwell),
      "--lyrics-halo-turn-time": `${metrics.haloTurnSeconds}s`,
    };
  }

  return {
    "--lyrics-ambient-blur": `${metrics.blurPx}px`,
    "--lyrics-ambient-brightness": String(metrics.brightness),
    "--lyrics-ambient-contrast": String(metrics.contrast),
    "--lyrics-ambient-idle-opacity": String(metrics.idleOpacity),
    "--lyrics-ambient-saturation": String(metrics.saturation),
    "--lyrics-ambient-scale-min": String(metrics.scaleMin),
    "--lyrics-ambient-wave-blur": `${metrics.waveBlurPx}px`,
    "--lyrics-ambient-wave-idle-opacity": String(metrics.waveIdleOpacity),
    "--lyrics-ambient-wave-inset": `${metrics.waveInsetPx * -1}px`,
    "--lyrics-ambient-wave-max-opacity": String(metrics.waveMaxOpacity),
    "--lyrics-ambient-wave-mid-opacity": String(metrics.waveMidOpacity),
    "--lyrics-ambient-wave-min-opacity": String(metrics.waveMinOpacity),
    "--lyrics-ambient-wave-one-max-opacity": String(metrics.waveOneMaxOpacity),
    "--lyrics-ambient-wave-scale-max": String(metrics.waveScaleMax),
    "--lyrics-ambient-wave-scale-mid": String(metrics.waveScaleMid),
    "--lyrics-ambient-wave-scale-min": String(metrics.waveScaleMin),
    "--lyrics-ambient-wave-two-max-opacity": String(metrics.waveTwoMaxOpacity),
    "--lyrics-ambient-wave-two-min-opacity": String(metrics.waveTwoMinOpacity),
    "--lyrics-ambient-wave-two-scale-max": String(metrics.waveTwoScaleMax),
  };
}
