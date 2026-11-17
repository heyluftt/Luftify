import type { LyricsVisualSettings } from "../../types/tauri";

export const DEFAULT_LYRICS_VISUAL_SETTINGS: LyricsVisualSettings = {
  enabled: false,
  mode: "pulse",
  spreadPercent: 48,
  colorStrengthPercent: 42,
  visualizerEnabled: false,
  visualizerSensitivityPercent: 62,
};

export const MAX_LYRICS_SPREAD_PERCENT = 100;
export const MAX_LYRICS_COLOR_STRENGTH_PERCENT = 200;
export const MAX_VISUALIZER_SENSITIVITY_PERCENT = 100;

export interface LyricsAmbientMetrics {
  blurPx: number;
  brightness: number;
  contrast: number;
  idleOpacity: number;
  maxOpacity: number;
  minOpacity: number;
  outerRingInsetPx: number;
  outerRingMinOpacity: number;
  outerRingOpacity: number;
  pulseBlurPx: number;
  pulseBrightness: number;
  pulseContrast: number;
  pulseDurationSeconds: number;
  pulseFarDurationSeconds: number;
  pulseNearDurationSeconds: number;
  pulseFloorOpacity: number;
  pulseSaturation: number;
  pulseShiftPercent: number;
  pulseTiltDegrees: number;
  ringInsetPx: number;
  ringMinOpacity: number;
  ringOpacity: number;
  saturation: number;
  scaleMax: number;
  scaleMid: number;
  scaleMin: number;
  waveBlurPx: number;
  waveIdleOpacity: number;
  waveInsetPx: number;
  waveMaxOpacity: number;
  waveMidOpacity: number;
  waveMinOpacity: number;
  waveOneMaxOpacity: number;
  waveScaleMax: number;
  waveScaleMid: number;
  waveScaleMin: number;
  waveTwoMaxOpacity: number;
  waveTwoMinOpacity: number;
  waveTwoScaleMax: number;
}

export function normalizeLyricsVisualSettings(
  value: Partial<LyricsVisualSettings> | undefined,
): LyricsVisualSettings {
  const settings = {
    ...DEFAULT_LYRICS_VISUAL_SETTINGS,
    ...value,
  };

  return {
    enabled: settings.enabled,
    mode: settings.mode === "waves" ? "waves" : "pulse",
    spreadPercent: clampPercent(
      settings.spreadPercent,
      MAX_LYRICS_SPREAD_PERCENT,
    ),
    colorStrengthPercent: clampPercent(
      settings.colorStrengthPercent,
      MAX_LYRICS_COLOR_STRENGTH_PERCENT,
    ),
    visualizerEnabled: settings.visualizerEnabled === true,
    visualizerSensitivityPercent: clampPercent(
      settings.visualizerSensitivityPercent,
      MAX_VISUALIZER_SENSITIVITY_PERCENT,
    ),
  };
}

export function lyricsAmbientMetrics(
  value: Partial<LyricsVisualSettings> | undefined,
): LyricsAmbientMetrics {
  const settings = normalizeLyricsVisualSettings(value);
  const spread = settings.spreadPercent / 100;
  const strength = Math.min(settings.colorStrengthPercent, 100) / 100;
  const boost = Math.max(0, settings.colorStrengthPercent - 100) / 100;
  const perceivedStrength = Math.pow(strength, 0.82);
  const peakBoost = Math.pow(strength, 2.4);

  return {
    blurPx: round(22 + spread * 36),
    brightness: round(0.92 + strength * 0.13 + boost * 0.18),
    contrast: round(1 + strength * 0.1 + boost * 0.12),
    idleOpacity: round(
      perceivedStrength * 0.035 + peakBoost * 0.015 + boost * 0.09,
    ),
    maxOpacity: round(
      perceivedStrength * 0.28 + peakBoost * 0.16 + boost * 0.38,
    ),
    minOpacity: round(
      perceivedStrength * 0.04 + peakBoost * 0.015 + boost * 0.05,
    ),
    outerRingInsetPx: round(18 + spread * 72 + boost * 56),
    outerRingMinOpacity: round(perceivedStrength * 0.012),
    outerRingOpacity: round(
      perceivedStrength * 0.14 + peakBoost * 0.09 + boost * 0.36,
    ),
    pulseBlurPx: round(Math.max(18, 20 + spread * 32 - boost * 12)),
    pulseBrightness: round(0.92 + strength * 0.13 + boost * 0.33),
    pulseContrast: round(1 + strength * 0.1 + boost * 0.28),
    pulseDurationSeconds: round(4.6 - boost * 1.5),
    pulseFarDurationSeconds: round(7.43 - boost * 2.09),
    pulseNearDurationSeconds: round(5.71 - boost * 1.78),
    pulseFloorOpacity: round(
      perceivedStrength * 0.028 + peakBoost * 0.012 + boost * 0.15,
    ),
    pulseSaturation: round(1.05 + strength * 1.25 + boost * 2.15),
    pulseShiftPercent: round(0.6 + boost * 1.8),
    pulseTiltDegrees: round(0.4 + boost * 2.8),
    ringInsetPx: round(8 + spread * 46 + boost * 30),
    ringMinOpacity: round(perceivedStrength * 0.022),
    ringOpacity: round(
      perceivedStrength * 0.2 + peakBoost * 0.13 + boost * 0.4,
    ),
    saturation: round(1.05 + strength * 1.25 + boost * 1.3),
    scaleMax: round(1.13 + spread * 0.27 + boost * 0.28),
    scaleMid: round(1.07 + spread * 0.15 + boost * 0.1),
    scaleMin: round(1.025 + spread * 0.075 + boost * 0.035),
    waveBlurPx: round(24 + spread * 30),
    waveIdleOpacity: round(
      perceivedStrength * 0.045 + peakBoost * 0.025 + boost * 0.07,
    ),
    waveInsetPx: round(10 + spread * 36),
    waveMaxOpacity: round(
      perceivedStrength * 0.36 + peakBoost * 0.3 + boost * 0.32,
    ),
    waveMidOpacity: round(
      perceivedStrength * 0.24 + peakBoost * 0.2 + boost * 0.3,
    ),
    waveMinOpacity: round(
      perceivedStrength * 0.065 + peakBoost * 0.035 + boost * 0.1,
    ),
    waveOneMaxOpacity: round(
      perceivedStrength * 0.3 + peakBoost * 0.28 + boost * 0.36,
    ),
    waveScaleMax: round(1.08 + spread * 0.09),
    waveScaleMid: round(1.035 + spread * 0.04),
    waveScaleMin: round(1.015 + spread * 0.03),
    waveTwoMaxOpacity: round(
      perceivedStrength * 0.255 + peakBoost * 0.245 + boost * 0.36,
    ),
    waveTwoMinOpacity: round(perceivedStrength * 0.048 + boost * 0.08),
    waveTwoScaleMax: round(1.065 + spread * 0.085),
  };
}

function clampPercent(value: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
