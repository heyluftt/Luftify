import { t } from "../../i18n";
import { CacheManagement } from "./CacheManagement";
import { ListeningAnalyticsSettings } from "./ListeningAnalyticsSettings";
import { SectionHeading, SettingsGroup, ToggleRow } from "./SettingsPrimitives";

export function PrivacySettings({
  searchHistoryEnabled,
  listeningAnalyticsEnabled,
  onSearchHistoryEnabled,
  onListeningAnalyticsEnabled,
}: {
  searchHistoryEnabled: boolean;
  listeningAnalyticsEnabled: boolean;
  onSearchHistoryEnabled: (enabled: boolean) => void;
  onListeningAnalyticsEnabled: (enabled: boolean) => void;
}) {
  return (
    <section id="settings-privacy" className="settings-section">
      <SectionHeading index="07" title={t("settingsUi.nav.privacy")} />
      <SettingsGroup title={t("settings.privacy.group")} description={t("settings.privacy.groupHint")}>
        <div className="settings-list">
          <ToggleRow label={t("settings.privacy.searchHistory")} description={t("settings.privacy.searchHistoryHint")} checked={searchHistoryEnabled} onChange={onSearchHistoryEnabled} />
        </div>
        <p className="settings-privacy-note">{t("settings.privacy.lyricsNote")}</p>
      </SettingsGroup>
      <SettingsGroup title={t("settings.analytics.group")} description={t("settings.analytics.groupHint")}>
        <ListeningAnalyticsSettings
          enabled={listeningAnalyticsEnabled}
          onEnabledChange={onListeningAnalyticsEnabled}
        />
      </SettingsGroup>
      <CacheManagement />
    </section>
  );
}
