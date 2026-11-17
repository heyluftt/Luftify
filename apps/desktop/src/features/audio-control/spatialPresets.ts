import { t } from "../../i18n";
import type { SpatialSettings } from "../../types/tauri";

export interface SpatialPreset extends SpatialSettings {
  name: string;
  description: string;
}

export const SPATIAL_PRESETS: SpatialPreset[] = [
  {
    enabled: false,
    presetId: "direct",
    get name() { return t("spatial.preset.direct"); },
    get description() { return t("spatial.preset.direct.hint"); },
    mixPercent: 0,
    preDelayMs: 0,
    decaySeconds: 1.2,
    dampingPercent: 55,
    stereoWidthPercent: 100,
  },
  {
    enabled: true,
    presetId: "studio",
    get name() { return t("spatial.preset.studio"); },
    get description() { return t("spatial.preset.studio.hint"); },
    mixPercent: 12,
    preDelayMs: 0,
    decaySeconds: 0.8,
    dampingPercent: 40,
    stereoWidthPercent: 110,
  },
  {
    enabled: true,
    presetId: "car",
    get name() { return t("spatial.preset.car"); },
    get description() { return t("spatial.preset.car.hint"); },
    cabinMode: true,
    mixPercent: 30,
    preDelayMs: 0,
    decaySeconds: 0.4,
    dampingPercent: 68,
    stereoWidthPercent: 82,
  },
  {
    enabled: true,
    presetId: "chamber",
    get name() { return t("spatial.preset.chamber"); },
    get description() { return t("spatial.preset.chamber.hint"); },
    mixPercent: 16,
    preDelayMs: 3,
    decaySeconds: 1.5,
    dampingPercent: 28,
    stereoWidthPercent: 118,
  },
  {
    enabled: true,
    presetId: "concert-hall",
    get name() { return t("spatial.preset.concert-hall"); },
    get description() { return t("spatial.preset.concert-hall.hint"); },
    mixPercent: 22,
    preDelayMs: 6,
    decaySeconds: 2.4,
    dampingPercent: 24,
    stereoWidthPercent: 134,
  },
  {
    enabled: true,
    presetId: "grand-hall",
    get name() { return t("spatial.preset.grand-hall"); },
    get description() { return t("spatial.preset.grand-hall.hint"); },
    mixPercent: 27,
    preDelayMs: 12,
    decaySeconds: 4.2,
    dampingPercent: 44,
    stereoWidthPercent: 146,
  },
];

export function applySpatialPreset(preset: SpatialPreset): SpatialSettings {
  return {
    enabled: preset.enabled,
    presetId: preset.presetId,
    cabinMode: preset.cabinMode ?? false,
    mixPercent: preset.mixPercent,
    preDelayMs: preset.preDelayMs,
    decaySeconds: preset.decaySeconds,
    dampingPercent: preset.dampingPercent,
    stereoWidthPercent: preset.stereoWidthPercent,
  };
}
