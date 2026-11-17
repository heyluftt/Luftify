import { AudioLines, Check, CircleAlert, Volume2, VolumeX } from "lucide-react";
import { t } from "../../i18n";
import type { AudioControlSettings } from "../../types/tauri";
import { usePlayback } from "../playback/usePlayback";
import { volumeCoordinator } from "../playback/VolumeCommandCoordinator";
import { spotifyToUi } from "./audioControl";
import { VolumeSlider } from "./VolumeSlider";

export type DspSaveState = "saved" | "saving" | "error";

interface AudioVolumeCardProps {
  settings: AudioControlSettings;
  activeStages: number;
  saveState: DspSaveState;
  bypassed: boolean;
  onBypassChange: (bypassed: boolean) => void;
}

/** Live volume plus the processed/original A/B switch for the DSP chain. */
export function AudioVolumeCard({ settings, activeStages, saveState, bypassed, onBypassChange }: AudioVolumeCardProps) {
  const { playback, connected } = usePlayback();
  const muted = Boolean(playback?.isMuted) || playback?.volume === 0;
  const uiVolume = playback?.isMuted ? 0 : spotifyToUi(playback?.volume ?? 0, settings.curve);
  const stageLabel = activeStages === 0
    ? t("audio.page.noStage")
    : activeStages === 1 ? t("audio.status.oneStage") : t("audio.status.stages", { count: activeStages });

  return (
    <section className="audio-volume-card">
      <div className="audio-volume-main">
        <div className="audio-volume-readout">
          <small>{t("audio.page.currentVolume")}</small>
          <strong>{Math.round(uiVolume * 100)}<span>%</span></strong>
        </div>
        <VolumeSlider
          settings={settings.enabled ? settings : { ...settings, curve: "linear", wheelEnabled: false }}
          large
        />
        <button
          type="button"
          className="secondary-button"
          disabled={!connected}
          onClick={() => void volumeCoordinator.toggleMute()}
        >
          {muted ? <Volume2 /> : <VolumeX />}
          {muted ? t("audio.page.unmute") : t("audio.page.mute")}
        </button>
      </div>

      <div className="audio-compare">
        <span className="audio-compare-copy">
          <AudioLines size={16} />
          <strong>{t("audio.page.compare")}</strong>
          <small>{stageLabel}</small>
        </span>
        <span className={`audio-save-state is-${saveState}`}>
          {saveState === "error" ? <CircleAlert size={13} /> : <Check size={13} />}
          {saveState === "saving" ? t("audio.page.soundSaving") : saveState === "error" ? t("audio.page.soundFailed") : t("audio.page.soundSaved")}
        </span>
        <div className="ds-segmented" role="group" aria-label={t("audio.page.compareLabel")}>
          <button type="button" aria-pressed={!bypassed} onClick={() => onBypassChange(false)}>{t("audio.page.processed")}</button>
          <button type="button" aria-pressed={bypassed} disabled={activeStages === 0} onClick={() => onBypassChange(true)}>{t("audio.page.original")}</button>
        </div>
      </div>
    </section>
  );
}
