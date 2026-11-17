import { ExternalLink, MonitorUp, MousePointer2, Pin } from "lucide-react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { useMiniPlayerSettings } from "../miniplayer/useMiniPlayerSettings";
import { SectionHeading, ToggleRow } from "./SettingsPrimitives";

export function MiniPlayerSettings() {
  const { settings: draft, update } = useMiniPlayerSettings();

  return (
    <section id="settings-miniplayer" className="settings-section miniplayer-settings">
      <SectionHeading index="06" title={t("miniplayer.settingsTitle")} description={t("miniplayer.settingsDescription")} />
      <div className="miniplayer-settings-card">
        <div className="miniplayer-settings-intro">
          <MonitorUp aria-hidden="true" />
          <div><strong>{t("miniplayer.readyTitle")}</strong><small>{t("miniplayer.readyDescription")}</small></div>
          <button type="button" className="secondary-button" onClick={() => void desktopApi.showMiniplayer()}><ExternalLink size={15} />{t("miniplayer.show")}</button>
        </div>
        <label className="miniplayer-range-row">
          <span><strong>{t("miniplayer.scale")}</strong><small>{t("miniplayer.scaleDescription")}</small></span>
          <input type="range" min={75} max={150} step={5} value={Math.round(draft.scale * 100)} onChange={(event) => update({ scale: Number(event.currentTarget.value) / 100 })} />
          <output>{Math.round(draft.scale * 100)}%</output>
        </label>
        <label className="miniplayer-range-row">
          <span><strong>{t("miniplayer.opacity")}</strong><small>{t("miniplayer.opacityDescription")}</small></span>
          <input type="range" min={35} max={100} step={1} value={draft.opacityPercent} onChange={(event) => update({ opacityPercent: Number(event.currentTarget.value) })} />
          <output>{draft.opacityPercent}%</output>
        </label>
        <div className="settings-list">
          <ToggleRow
            icon={Pin}
            label={t("miniplayer.alwaysOnTop")}
            description={t("miniplayer.alwaysOnTopDescription")}
            checked={draft.alwaysOnTop}
            onChange={(alwaysOnTop) => update({ alwaysOnTop })}
          />
          <ToggleRow
            icon={MousePointer2}
            label={t("miniplayer.clickThrough")}
            description={t("miniplayer.clickThroughDescription")}
            checked={draft.clickThrough}
            onChange={(clickThrough) => update({ clickThrough })}
          />
        </div>
        <p className="miniplayer-settings-note">{t("miniplayer.clickThroughHotkey")}</p>
        <p className="miniplayer-settings-note">{t("miniplayer.adminShortcutHint")}</p>
        <p className="miniplayer-settings-note">{t("miniplayer.exclusiveFullscreen")}</p>
      </div>
    </section>
  );
}
