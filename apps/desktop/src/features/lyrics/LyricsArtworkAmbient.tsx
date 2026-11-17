import { useRef, type CSSProperties } from "react";

import { AlbumArt } from "../../components/AlbumArt";
import type { LyricsVisualSettings } from "../../types/tauri";
import {
  lyricsAmbientMetrics,
  normalizeLyricsVisualSettings,
} from "./lyricsVisualSettings";
import { useAmbientVisualizer } from "./useAmbientVisualizer";

interface LyricsArtworkAmbientProps {
  image: string | undefined;
  playing: boolean;
  settings: LyricsVisualSettings;
  title: string;
}

type AmbientStyle = CSSProperties & Record<`--lyrics-ambient-${string}`, string>;

export function LyricsArtworkAmbient({
  image,
  playing,
  settings,
  title,
}: LyricsArtworkAmbientProps) {
  const normalized = normalizeLyricsVisualSettings(settings);
  const ambientRef = useRef<HTMLDivElement>(null);
  const visualizerActive = useAmbientVisualizer({
    enabled: normalized.enabled && normalized.visualizerEnabled,
    playing,
    mode: normalized.mode,
    spreadPercent: normalized.spreadPercent,
    colorStrengthPercent: normalized.colorStrengthPercent,
    sensitivityPercent: normalized.visualizerSensitivityPercent,
    target: ambientRef,
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
          className={`lyrics-artwork-ambient mode-${normalized.mode}${playing ? " is-playing" : ""}${visualizerActive ? " is-visualizer" : ""}`}
          style={ambientStyle(normalized)}
          aria-hidden="true"
        >
          <div className="lyrics-artwork-pulse">
            <div className="lyrics-artwork-ambient-source">
              <AlbumArt
                title={title}
                size="feature"
                image={image}
              />
            </div>
          </div>
          {normalized.mode === "waves" && (
            <div className="lyrics-artwork-waves">
              <div className="lyrics-artwork-wave-ribbon ribbon-one" />
              <div className="lyrics-artwork-wave-ribbon ribbon-two" />
              <div className="lyrics-artwork-wave-ribbon ribbon-three" />
              <div className="lyrics-artwork-wave wave-one">
                <div className="lyrics-artwork-ambient-source">
                  <AlbumArt
                    title={title}
                    size="feature"
                    image={image}
                  />
                </div>
              </div>
              <div className="lyrics-artwork-wave wave-two">
                <div className="lyrics-artwork-ambient-source">
                  <AlbumArt
                    title={title}
                    size="feature"
                    image={image}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ambientStyle(settings: LyricsVisualSettings): AmbientStyle {
  const metrics = lyricsAmbientMetrics(settings);

  return {
    "--lyrics-ambient-blur": `${metrics.blurPx}px`,
    "--lyrics-ambient-brightness": String(metrics.brightness),
    "--lyrics-ambient-contrast": String(metrics.contrast),
    "--lyrics-ambient-idle-opacity": String(metrics.idleOpacity),
    "--lyrics-ambient-max-opacity": String(metrics.maxOpacity),
    "--lyrics-ambient-min-opacity": String(metrics.minOpacity),
    "--lyrics-ambient-outer-ring-inset": `${metrics.outerRingInsetPx * -1}px`,
    "--lyrics-ambient-outer-ring-min-opacity": String(metrics.outerRingMinOpacity),
    "--lyrics-ambient-outer-ring-opacity": String(metrics.outerRingOpacity),
    "--lyrics-ambient-pulse-blur": `${metrics.pulseBlurPx}px`,
    "--lyrics-ambient-pulse-brightness": String(metrics.pulseBrightness),
    "--lyrics-ambient-pulse-contrast": String(metrics.pulseContrast),
    "--lyrics-ambient-pulse-duration": `${metrics.pulseDurationSeconds}s`,
    "--lyrics-ambient-pulse-far-duration": `${metrics.pulseFarDurationSeconds}s`,
    "--lyrics-ambient-pulse-near-duration": `${metrics.pulseNearDurationSeconds}s`,
    "--lyrics-ambient-pulse-floor-opacity": String(metrics.pulseFloorOpacity),
    "--lyrics-ambient-pulse-saturation": String(metrics.pulseSaturation),
    "--lyrics-ambient-pulse-shift": `${metrics.pulseShiftPercent}%`,
    "--lyrics-ambient-pulse-shift-negative": `${metrics.pulseShiftPercent * -1}%`,
    "--lyrics-ambient-pulse-tilt": `${metrics.pulseTiltDegrees}deg`,
    "--lyrics-ambient-pulse-tilt-negative": `${metrics.pulseTiltDegrees * -1}deg`,
    "--lyrics-ambient-ring-inset": `${metrics.ringInsetPx * -1}px`,
    "--lyrics-ambient-ring-min-opacity": String(metrics.ringMinOpacity),
    "--lyrics-ambient-ring-opacity": String(metrics.ringOpacity),
    "--lyrics-ambient-saturation": String(metrics.saturation),
    "--lyrics-ambient-scale-max": String(metrics.scaleMax),
    "--lyrics-ambient-scale-mid": String(metrics.scaleMid),
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
