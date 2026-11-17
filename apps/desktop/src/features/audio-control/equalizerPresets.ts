import { t, type MessageKey } from "../../i18n";
import type { DspSettings } from "../../types/tauri";

export const EQ_FREQUENCIES = [
  { hz: 31, label: "31" },
  { hz: 62, label: "62" },
  { hz: 125, label: "125" },
  { hz: 250, label: "250" },
  { hz: 500, label: "500" },
  { hz: 1_000, label: "1k" },
  { hz: 2_000, label: "2k" },
  { hz: 4_000, label: "4k" },
  { hz: 8_000, label: "8k" },
  { hz: 16_000, label: "16k" },
] as const;

export interface EqualizerPreset {
  id: string;
  readonly name: string;
  bandsDb: number[];
}

function preset(id: string, bandsDb: number[]): EqualizerPreset {
  return {
    id,
    get name() { return t(`equalizer.preset.${id}` as MessageKey); },
    bandsDb,
  };
}

// Also listed in luft-audio (REVISED_EQ_PRESETS) to move untouched stored
// presets to these values.
export const EQUALIZER_PRESETS: EqualizerPreset[] = [
  preset("neutral", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  // A gentle downward tilt: fuller lows, softer treble.
  preset("warm", [1.8, 1.8, 1.4, 0.8, 0.2, 0, -0.3, -0.7, -1, -1.2]),
  // Weight around 60 Hz, where music and headphones still deliver, with the
  // low mids pulled back so the boost does not boom.
  preset("deep", [3.5, 4, 2.5, 0.5, -0.8, -0.5, 0, 0.3, 0.3, 0]),
  // Less mud at 250 Hz and more air on top instead of a harsh 2-4 kHz push.
  preset("clear", [-0.5, -0.5, -0.8, -1.2, -0.6, 0.2, 0.8, 1.2, 1.6, 1.4]),
  // Speech intelligibility sits at 2-4 kHz; lows and sibilance stay back.
  preset("voice", [-3, -2.2, -1, 0.3, 1.2, 1.8, 2.2, 1.6, 0.2, -0.6]),
  // Quiet listening: the ear loses bass and some air at low levels
  // (equal-loudness contours), while 2-4 kHz already sounds present.
  preset("night", [3.5, 2.8, 1.6, 0.6, 0, -0.2, -0.4, -0.2, 0.8, 1.6]),
];

export function applyEqualizerPreset(settings: DspSettings, preset: EqualizerPreset): DspSettings {
  return {
    ...settings,
    presetId: preset.id,
    bandsDb: [...preset.bandsDb],
  };
}

export function displayGain(gain: number): string {
  if (Math.abs(gain) < 0.05) return "0";
  return `${gain > 0 ? "+" : ""}${gain.toFixed(1)}`;
}
