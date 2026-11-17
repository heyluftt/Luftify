import { BarChart3, LayoutDashboard, RotateCcw } from "lucide-react";
import { t } from "../../i18n";
import type { HomeFeatureMode, Settings } from "../../types/tauri";
import { SectionHeading, SelectRow, SettingsGroup } from "./SettingsPrimitives";

export function HomeSettings({
  settings,
  playlists,
  resetPending,
  resetDone,
  onMode,
  onPlaylist,
  onReset,
}: {
  settings: Settings;
  playlists: Array<{ uri: string; name: string }>;
  resetPending: boolean;
  resetDone: boolean;
  onMode: (mode: HomeFeatureMode) => void;
  onPlaylist: (uri: string) => void;
  onReset: () => void;
}) {
  const selectedAvailable = playlists.some((playlist) => playlist.uri === settings.homeFeaturePlaylistUri);
  return (
    <section id="settings-home" className="settings-section">
      <SectionHeading index="04" title={t("settings.home.title")} />
      <SettingsGroup title={t("settings.home.featured")}>
        <div className="settings-list">
          <SelectRow
            icon={LayoutDashboard}
            label={t("settings.home.selection")}
            value={settings.homeFeatureMode}
            onChange={onMode}
          >
            <option value="lastPlayed">{t("settings.home.lastPlayed")}</option>
            <option value="mostPlayed">{t("settings.home.mostPlayed")}</option>
            <option value="personalized">{t("settings.home.personalized")}</option>
            <option value="fixed">{t("settings.home.fixed")}</option>
          </SelectRow>
          {settings.homeFeatureMode === "fixed" && (
            <SelectRow
              icon={LayoutDashboard}
              label={t("settings.home.choosePlaylist")}
              value={settings.homeFeaturePlaylistUri ?? ""}
              onChange={onPlaylist}
            >
              <option value="">{t("settings.home.auto")}</option>
              {settings.homeFeaturePlaylistUri && !selectedAvailable && (
                <option value={settings.homeFeaturePlaylistUri}>{t("settings.home.previousPlaylist")}</option>
              )}
              {playlists.map((playlist) => (
                <option key={playlist.uri} value={playlist.uri}>{playlist.name}</option>
              ))}
            </SelectRow>
          )}
        </div>
      </SettingsGroup>
      <div className="settings-insight">
        <span className="setting-icon"><BarChart3 /></span>
        <span><strong>{t("settings.home.counters")}</strong><small>{t("settings.home.countersHint")}</small></span>
        <button type="button" className="secondary-button" disabled={resetPending} onClick={onReset}>
          <RotateCcw size={15} />{resetPending ? t("settings.home.clearing") : resetDone ? t("settings.home.cleared") : t("settings.home.clear")}
        </button>
      </div>
    </section>
  );
}
