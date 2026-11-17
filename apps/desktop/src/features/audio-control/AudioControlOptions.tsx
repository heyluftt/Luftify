import type { ReactNode } from "react";
import { t } from "../../i18n";
import type { AudioControlSettings } from "../../types/tauri";
import { SettingsSelect } from "../settings/SettingsSelect";
import { setAudioPreset } from "./audioControl";

type SettingsUpdate = (update: (settings: AudioControlSettings) => AudioControlSettings) => void;

/** Volume favourites, step/curve and shortcut options of the audio module. */
export function AudioControlOptions({ settings, onChange }: { settings: AudioControlSettings; onChange: SettingsUpdate }) {
  const toggle = (key: "wheelEnabled" | "restoreOnStart" | "rememberBeforeMute" | "showPercentage" | "shortcutsEnabled") =>
    (checked: boolean) => onChange((state) => ({ ...state, [key]: checked }));

  return (
    <>
      <section className="audio-section">
        <div className="section-title">
          <div><span className="eyebrow">{t("audio.page.presetsEyebrow")}</span><h2>{t("audio.page.presets")}</h2></div>
        </div>
        <div className="audio-preset-editor">
          {settings.presets.map((preset, index) => (
            <div className="audio-preset" key={index}>
              <button
                type="button"
                aria-label={t("audio.page.presetApply", { value: preset })}
                onClick={() => setAudioPreset(preset, settings.curve)}
              >
                {preset}<span>%</span>
              </button>
              <input
                aria-label={t("audio.page.presetLabel", { index: index + 1 })}
                type="number"
                min={0}
                max={100}
                value={preset}
                onChange={(event) => {
                  const value = Math.min(100, Math.max(0, Number(event.currentTarget.value)));
                  onChange((state) => ({
                    ...state,
                    presets: state.presets.map((item, itemIndex) => itemIndex === index ? value : item),
                  }));
                }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="audio-section">
        <div className="section-title"><h2>{t("audio.page.controls")}</h2></div>
        <div className="settings-list">
          <OptionSelect
            label={t("audio.page.step")}
            value={String(settings.stepPercent)}
            onChange={(value) => onChange((state) => ({ ...state, stepPercent: Number(value) as AudioControlSettings["stepPercent"] }))}
          >
            <option value="1">1 %</option><option value="2">2 %</option>
            <option value="5">5 %</option><option value="10">10 %</option>
          </OptionSelect>
          <OptionSelect
            label={t("audio.page.curve")}
            value={settings.curve}
            onChange={(curve) => onChange((state) => ({ ...state, curve: curve as AudioControlSettings["curve"] }))}
          >
            <option value="linear">{t("audio.page.curveLinear")}</option>
            <option value="perceptual">{t("audio.page.curvePerceptual")}</option>
          </OptionSelect>
          <OptionToggle label={t("audio.page.wheel")} checked={settings.wheelEnabled} onChange={toggle("wheelEnabled")} />
          <OptionToggle label={t("audio.page.restore")} checked={settings.restoreOnStart} onChange={toggle("restoreOnStart")} />
          <OptionToggle label={t("audio.page.rememberMute")} checked={settings.rememberBeforeMute} onChange={toggle("rememberBeforeMute")} />
          <OptionToggle label={t("audio.page.showPercent")} checked={settings.showPercentage} onChange={toggle("showPercentage")} />
          <OptionToggle label={t("audio.page.shortcuts")} checked={settings.shortcutsEnabled} onChange={toggle("shortcutsEnabled")} />
        </div>
        {settings.shortcutsEnabled && (
          <div className="audio-shortcuts">
            <ShortcutField label={t("audio.page.louder")} value={settings.volumeUpShortcut} onChange={(volumeUpShortcut) => onChange((state) => ({ ...state, volumeUpShortcut }))} />
            <ShortcutField label={t("audio.page.quieter")} value={settings.volumeDownShortcut} onChange={(volumeDownShortcut) => onChange((state) => ({ ...state, volumeDownShortcut }))} />
            <ShortcutField label={t("audio.page.muteKey")} value={settings.muteShortcut} onChange={(muteShortcut) => onChange((state) => ({ ...state, muteShortcut }))} />
          </div>
        )}
      </section>
    </>
  );
}

function OptionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="setting-row">
      <span><strong>{label}</strong></span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} /><span />
      </span>
    </label>
  );
}

function OptionSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <div className="setting-row setting-select">
      <span><strong>{label}</strong></span>
      <SettingsSelect label={label} value={value} onChange={onChange}>{children}</SettingsSelect>
    </div>
  );
}

function ShortcutField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="audio-shortcut">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}
