import { ChevronRight, RotateCcw, SlidersHorizontal } from "lucide-react";
import { t } from "../../i18n";
import type { Settings } from "../../types/tauri";
import { LibreSessionSection } from "./LibreSessionSettings";
import { SectionHeading, SelectRow, SettingsGroup } from "./SettingsPrimitives";

export function PlaybackSettings({
  settings,
  onPatch,
}: {
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => void;
}) {
  return (
    <section id="settings-playback" className="settings-section">
      <SectionHeading index="01" title={t("settingsUi.nav.playback")} />

      <LibreSessionSection
        outputDevice={settings.librespotAudioDevice ?? ""}
        quality={settings.librespotStreamingQuality ?? "high"}
        loudness={settings.librespotLoudness ?? "off"}
        onOutputDevice={(librespotAudioDevice) => onPatch({ librespotAudioDevice })}
        onQuality={(librespotStreamingQuality) => onPatch({ librespotStreamingQuality })}
        onLoudness={(librespotLoudness) => onPatch({ librespotLoudness })}
      />

      <SettingsGroup title={t("settingsUi.resume")}>
        <div className="settings-list">
          <SelectRow icon={RotateCcw} label={t("settings.connection.resume")} value={settings.reconnectResumeMode} onChange={(reconnectResumeMode) => onPatch({ reconnectResumeMode })}>
            <option value="never">{t("settings.connection.resumeNever")}</option>
            <option value="ifWasPlaying">{t("settings.connection.resumeIfPlaying")}</option>
            <option value="always">{t("settings.connection.resumeAlways")}</option>
          </SelectRow>
        </div>
      </SettingsGroup>

      <a className="settings-analytics-link settings-related-link" href="#/modules/audio-control">
        <span className="setting-icon"><SlidersHorizontal aria-hidden="true" /></span>
        <span>
          <strong>{t("settings.audioLink.title")}</strong>
          <small>{t("settings.audioLink.hint")}</small>
        </span>
        <ChevronRight aria-hidden="true" />
      </a>
    </section>
  );
}
