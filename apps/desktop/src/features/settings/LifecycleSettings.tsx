import { MonitorUp, PanelBottomClose, Power } from "lucide-react";
import { t } from "../../i18n";
import type { Settings } from "../../types/tauri";
import { SectionHeading, SelectRow, SettingsGroup, ToggleRow } from "./SettingsPrimitives";
import { UpdateSettings } from "../updates/UpdateSettings";
import { ProblemReportSettings } from "../problem-report/ProblemReportSettings";

export function LifecycleSettings({
  settings,
  onPatch,
}: {
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => void;
}) {
  return (
    <section id="settings-lifecycle" className="settings-section">
      <SectionHeading index="05" title={t("settingsUi.nav.window")} />
      <SettingsGroup title={t("settings.app.title")}>
        <div className="settings-list">
          <SelectRow icon={PanelBottomClose} label={t("settings.app.close")} value={settings.closeBehavior} onChange={(closeBehavior) => onPatch({ closeBehavior })}>
            <option value="exit">{t("settings.app.exit")}</option>
            <option value="minimizeToTray">{t("settings.app.tray")}</option>
            <option value="ask">{t("settings.app.ask")}</option>
          </SelectRow>
          <ToggleRow icon={Power} label={t("settings.app.autostart")} checked={settings.windowsAutostart} onChange={(windowsAutostart) => onPatch({ windowsAutostart })} />
          <ToggleRow icon={MonitorUp} label={t("settings.app.startInTray")} checked={settings.startInTrayOnAutostart} disabled={!settings.windowsAutostart} onChange={(startInTrayOnAutostart) => onPatch({ startInTrayOnAutostart })} />
        </div>
      </SettingsGroup>
      <UpdateSettings />
      <ProblemReportSettings />
    </section>
  );
}
