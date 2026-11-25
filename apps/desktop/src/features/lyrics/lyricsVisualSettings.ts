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
  beamFarReachPx: number;
  beamOpacity: number;
  beamTurnSeconds: number;
  beamWidthPx: number;
  blurPx: number;
  brightness: number;
  contrast: number;
  haloBlurPx: number;
  haloMaxOpacity: number;
  haloMinOpacity: number;
  haloReachPercent: number;
  haloRestOpacity: number;
  haloSaturation: number;
  haloSwell: number;
  haloTurnSeconds: number;
  idleOpacity: number;
  saturation: number;
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
    beamFarReachPx: round(13 + spread * 16),
    beamOpacity: round(Math.min(1, perceivedStrength * 1.35 + boost * 0.3)),
    beamTurnSeconds: round(8 - boost * 2.5),
    beamWidthPx: round(2.5 + strength + boost * 1.5),
    blurPx: round(22 + spread * 36),
    brightness: round(0.92 + strength * 0.13 + boost * 0.18),
    contrast: round(1 + strength * 0.1 + boost * 0.12),
    haloBlurPx: round(14 + spread * 18),
    haloMaxOpacity: round(
      Math.min(0.9, perceivedStrength * 1.15 + peakBoost * 0.3 + boost * 0.2),
    ),
    haloMinOpacity: round(
      perceivedStrength * 0.5 + peakBoost * 0.1 + boost * 0.12,
    ),
    haloReachPercent: round(18 + spread * 32),
    haloRestOpacity: round(perceivedStrength * 0.16 + boost * 0.1),
    haloSaturation: round(1.1 + strength * 0.7 + boost * 0.9),
    haloSwell: round(0.06 + spread * 0.1 + boost * 0.05),
    haloTurnSeconds: round(15 - boost * 5),
    idleOpacity: round(
      perceivedStrength * 0.035 + peakBoost * 0.015 + boost * 0.09,
    ),
    saturation: round(1.05 + strength * 1.25 + boost * 1.3),
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
