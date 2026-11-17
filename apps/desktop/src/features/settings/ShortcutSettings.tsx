import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { t } from "../../i18n";
import type { Settings } from "../../types/tauri";
import { SectionHeading, SettingsGroup } from "./SettingsPrimitives";

const KEY_NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

function keys(shortcut: string | undefined): string[] {
  return (shortcut ?? "")
    .split("+")
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => (key === "Space" || key === " " ? t("settings.shortcut.space") : KEY_NAMES[key] ?? key));
}

export function ShortcutSettings({ audio }: { audio: Settings["audioControl"] }) {
  const general: Array<[string[], string]> = [
    [["Ctrl", "K"], t("command.searchOrRun")],
    [["/"], t("settings.shortcut.searchJump")],
    [[t("settings.shortcut.space")], t("settings.shortcut.playPause")],
    [["Alt", "←", "→"], t("settings.shortcut.history")],
    [["Ctrl", "L"], t("nav.library")],
    [["Ctrl", "Q"], t("settingsUi.shortcut.queue")],
    [["Ctrl", ","], t("nav.settings")],
    [["Ctrl", "Shift", "F10"], t("settingsUi.shortcut.clickThrough")],
  ];
  const volume: Array<[string[], string]> = [
    [keys(audio.volumeUpShortcut), t("settingsUi.shortcut.volumeUp")],
    [keys(audio.volumeDownShortcut), t("settingsUi.shortcut.volumeDown")],
    [keys(audio.muteShortcut), t("settingsUi.shortcut.mute")],
  ];
  const volumeActive = audio.enabled && audio.shortcutsEnabled;

  return (
    <section id="settings-shortcuts" className="settings-section">
      <SectionHeading index="10" title={t("settingsUi.nav.shortcuts")} />
      <SettingsGroup title={t("settingsUi.shortcut.navigation")}>
        <ShortcutList entries={general} />
      </SettingsGroup>
      <SettingsGroup
        title={t("settingsUi.shortcut.audio")}
        {...(volumeActive ? {} : { description: t("settingsUi.shortcut.audioOff") })}
      >
        {volumeActive && <ShortcutList entries={volume} />}
        <a className="settings-analytics-link settings-related-link settings-shortcut-edit" href="#/modules/audio-control">
          <span className="setting-icon"><SlidersHorizontal aria-hidden="true" /></span>
          <span>
            <strong>{t("settingsUi.shortcut.edit")}</strong>
          </span>
          <ChevronRight aria-hidden="true" />
        </a>
      </SettingsGroup>
    </section>
  );
}

function ShortcutList({ entries }: { entries: Array<[string[], string]> }) {
  return (
    <ul className="shortcut-list">
      {entries.map(([combo, label]) => (
        <li key={label}>
          {combo.map((key, index) => <kbd key={`${key}${index}`}>{key}</kbd>)}
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}
