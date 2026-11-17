import { AudioLines, Gauge } from "lucide-react";
import { t } from "../../i18n";
import type { LoudnessNormalization, StreamingQuality } from "../../types/tauri";
import { SelectRow } from "./SettingsPrimitives";

const QUALITIES: StreamingQuality[] = ["low", "normal", "high"];
const LOUDNESS: LoudnessNormalization[] = ["off", "quiet", "normal", "loud"];

/** Libre's bitrate and loudness normalization; both reopen the player. */
export function LibrespotPlaybackQuality({
  enabled,
  switching,
  quality,
  loudness,
  onQuality,
  onLoudness,
}: {
  enabled: boolean;
  switching: boolean;
  quality: StreamingQuality;
  loudness: LoudnessNormalization;
  onQuality: (quality: StreamingQuality) => void;
  onLoudness: (loudness: LoudnessNormalization) => void;
}) {
  return (
    <div className="settings-list settings-quality-group">
      <SelectRow
        icon={Gauge}
        label={t("audio.quality.label")}
        description={t("audio.quality.hint")}
        disabled={!enabled || switching}
        value={quality}
        onChange={onQuality}
      >
        {QUALITIES.map((value) => (
          <option key={value} value={value}>{t(`audio.quality.${value}`)}</option>
        ))}
      </SelectRow>
      <SelectRow
        icon={AudioLines}
        label={t("audio.loudness.label")}
        description={t("audio.loudness.hint")}
        disabled={!enabled || switching}
        value={loudness}
        onChange={onLoudness}
      >
        {LOUDNESS.map((value) => (
          <option key={value} value={value}>{t(`audio.loudness.${value}`)}</option>
        ))}
      </SelectRow>
    </div>
  );
}
