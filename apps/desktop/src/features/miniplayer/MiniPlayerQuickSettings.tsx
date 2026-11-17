import { MousePointer2, Pin } from "lucide-react";
import { t } from "../../i18n";
import type { MiniPlayerSettings } from "../../types/tauri";

export function MiniPlayerQuickSettings({
  settings,
  update,
}: {
  settings: MiniPlayerSettings;
  update: (patch: Partial<MiniPlayerSettings>) => void;
}) {
  return (
    <section className="miniplayer-quick-settings" aria-label={t("miniplayer.settingsTitle")}>
      <label className="miniplayer-quick-range">
        <span>{t("miniplayer.scale")}<output>{Math.round(settings.scale * 100)}%</output></span>
        <input type="range" min={75} max={150} step={5} value={Math.round(settings.scale * 100)} onChange={(event) => update({ scale: Number(event.currentTarget.value) / 100 })} />
      </label>
      <label className="miniplayer-quick-range">
        <span>{t("miniplayer.opacity")}<output>{settings.opacityPercent}%</output></span>
        <input type="range" min={35} max={100} step={1} value={settings.opacityPercent} onChange={(event) => update({ opacityPercent: Number(event.currentTarget.value) })} />
      </label>
      <div className="miniplayer-quick-toggles">
        <button type="button" className={settings.alwaysOnTop ? "active" : ""} aria-pressed={settings.alwaysOnTop} aria-label={t("miniplayer.alwaysOnTop")} title={t("miniplayer.alwaysOnTop")} onClick={() => update({ alwaysOnTop: !settings.alwaysOnTop })}><Pin size={15} /></button>
        <button type="button" className={settings.clickThrough ? "active" : ""} aria-pressed={settings.clickThrough} aria-label={t("miniplayer.clickThrough")} title={t("miniplayer.clickThroughDescription")} onClick={() => update({ clickThrough: !settings.clickThrough })}><MousePointer2 size={15} /></button>
        <kbd title={`${t("miniplayer.clickThroughHotkey")}\n${t("miniplayer.adminShortcutHint")}`}>{t("miniplayer.clickThroughShortcut")}</kbd>
      </div>
    </section>
  );
}
