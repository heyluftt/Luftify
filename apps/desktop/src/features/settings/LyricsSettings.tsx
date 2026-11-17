import { MicVocal, Video } from "lucide-react";
import { t } from "../../i18n";
import type { Settings } from "../../types/tauri";
import { LyricsVisualSettingsPanel } from "../lyrics/LyricsVisualSettingsPanel";
import { SectionHeading, SettingsGroup, ToggleRow } from "./SettingsPrimitives";

export function LyricsSettings({
  visualSettings,
  lyricsEnabled,
  experimentalLibreCanvas,
  onVisualSettings,
  onLyricsEnabled,
  onExperimentalLibreCanvas,
}: {
  visualSettings: Settings["lyricsVisuals"];
  lyricsEnabled: boolean;
  experimentalLibreCanvas: boolean;
  onVisualSettings: (settings: Settings["lyricsVisuals"]) => void;
  onLyricsEnabled: (enabled: boolean) => void;
  onExperimentalLibreCanvas: (enabled: boolean) => void;
}) {
  return (
    <section id="settings-lyrics" className="settings-section">
      <SectionHeading index="03" title={t("settingsUi.nav.lyrics")} />
      <SettingsGroup title={t("settings.lyrics.title")}>
        <div className="settings-list">
          <ToggleRow
            icon={MicVocal}
            label={t("settings.lyrics.load")}
            description={t("settings.lyrics.loadHint")}
            checked={lyricsEnabled}
            onChange={onLyricsEnabled}
          />
          <ToggleRow
            icon={Video}
            label={t("settings.lyrics.libreVideos")}
            description={t("settings.lyrics.libreVideosHint")}
            checked={experimentalLibreCanvas}
            onChange={onExperimentalLibreCanvas}
          />
        </div>
      </SettingsGroup>
      <LyricsVisualSettingsPanel value={visualSettings} onChange={onVisualSettings} />
    </section>
  );
}
