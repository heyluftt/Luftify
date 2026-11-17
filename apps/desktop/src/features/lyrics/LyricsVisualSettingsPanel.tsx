import {
  AudioLines,
  Expand,
  Gauge,
  Palette,
  Waves,
} from "lucide-react";

import { t } from "../../i18n";
import type { LyricsVisualSettings } from "../../types/tauri";
import {
  MAX_LYRICS_COLOR_STRENGTH_PERCENT,
  MAX_LYRICS_SPREAD_PERCENT,
  MAX_VISUALIZER_SENSITIVITY_PERCENT,
  normalizeLyricsVisualSettings,
} from "./lyricsVisualSettings";

interface LyricsVisualSettingsPanelProps {
  onChange: (settings: LyricsVisualSettings) => void;
  value: LyricsVisualSettings;
}

export function LyricsVisualSettingsPanel({
  onChange,
  value,
}: LyricsVisualSettingsPanelProps) {
  const settings = normalizeLyricsVisualSettings(value);
  const mode = settings.mode ?? "pulse";
  const spread = settings.spreadPercent / 100;
  const strength = Math.min(settings.colorStrengthPercent, 100) / 100;
  const boost = Math.max(0, settings.colorStrengthPercent - 100) / 100;
  const perceivedStrength = Math.pow(strength, 0.82);
  const peakBoost = Math.pow(strength, 2.4);
  const previewStyle = {
    "--preview-blur": `${9 + spread * 15 + boost * (mode === "pulse" ? 2 : 4)}px`,
    "--preview-max-opacity": String(
      perceivedStrength * 0.28
        + peakBoost * 0.16
        + boost * (mode === "pulse" ? 0.38 : 0.22),
    ),
    "--preview-min-opacity": String(
      perceivedStrength * 0.04
        + peakBoost * 0.015
        + boost * (mode === "pulse" ? 0.05 : 0.035),
    ),
    "--preview-pulse-duration": `${4.6 - boost * 1.5}s`,
    "--preview-pulse-far-duration": `${7.43 - boost * 2.09}s`,
    "--preview-pulse-near-duration": `${5.71 - boost * 1.78}s`,
    "--preview-pulse-shift": `${1 + boost * 3}px`,
    "--preview-pulse-shift-negative": `${-1 - boost * 3}px`,
    "--preview-pulse-tilt": `${0.4 + boost * 2.8}deg`,
    "--preview-pulse-tilt-negative": `${-0.4 - boost * 2.8}deg`,
    "--preview-ring-opacity": String(
      perceivedStrength * 0.2
        + peakBoost * 0.13
        + boost * (mode === "pulse" ? 0.4 : 0.24),
    ),
    "--preview-saturation": String(
      1.05 + strength * 1.25 + boost * (mode === "pulse" ? 2.15 : 1.3),
    ),
    "--preview-scale-max": String(
      1.13 + spread * 0.27 + boost * (mode === "pulse" ? 0.28 : 0.11),
    ),
    "--preview-scale-mid": String(
      1.07 + spread * 0.15 + boost * (mode === "pulse" ? 0.1 : 0.05),
    ),
    "--preview-scale-min": String(
      1.025 + spread * 0.075 + boost * (mode === "pulse" ? 0.035 : 0.025),
    ),
  } as React.CSSProperties;
  const update = (change: Partial<LyricsVisualSettings>) => {
    onChange({ ...settings, ...change });
  };

  return (
    <div className="settings-group lyrics-visual-settings">
      <div className="settings-group-heading">
        <strong>{t("settings.lyricsView.title")}</strong>
        <small>{t("settings.lyricsView.description")}</small>
      </div>

      <div
        className="lyrics-visual-preview"
        data-enabled={settings.enabled}
        data-mode={mode}
        data-visualizer={settings.visualizerEnabled}
        style={previewStyle}
        aria-hidden="true"
      >
        <span className="lyrics-visual-preview-aura" />
        <span className="lyrics-visual-preview-aura is-secondary" />
        <b className="lyrics-visual-preview-ring" />
        <i className="lyrics-visual-preview-cover" />
        <small>
          {settings.enabled
            ? settings.visualizerEnabled
              ? mode === "waves"
                ? t("settings.lyricsView.wavesFollow")
                : t("settings.lyricsView.pulseFollow")
              : mode === "waves"
                ? t("settings.lyricsView.wavesOn")
                : t("settings.lyricsView.pulseOn")
            : t("settings.lyricsView.still")}
        </small>
      </div>

      <div className="settings-list">
        <label className="setting-row">
          <span className="setting-icon">
            <Waves />
          </span>
          <span>
            <strong>{t("settings.lyricsView.ambient")}</strong>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => update({ enabled: event.currentTarget.checked })}
            />
            <span />
          </span>
        </label>

        <label className={settings.enabled ? "setting-row" : "setting-row disabled"}>
          <span className="setting-icon">
            <AudioLines />
          </span>
          <span>
            <strong>{t("settings.lyricsView.visualizer")}</strong>
            <small>{t("settings.lyricsView.visualizerHint")}</small>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={settings.visualizerEnabled}
              disabled={!settings.enabled}
              onChange={(event) =>
                update({ visualizerEnabled: event.currentTarget.checked })}
            />
            <span />
          </span>
        </label>

        <fieldset
          className="lyrics-visual-mode"
          disabled={!settings.enabled}
        >
          <legend>{t("settings.lyricsView.style")}</legend>
          <div className="lyrics-visual-mode-options">
            <AmbientModeOption
              checked={mode === "pulse"}
              label={t("settings.lyricsView.pulse")}
              mode="pulse"
              onChange={(nextMode) => update({ mode: nextMode })}
            />
            <AmbientModeOption
              checked={mode === "waves"}
              label={t("settings.lyricsView.waves")}
              mode="waves"
              onChange={(nextMode) => update({ mode: nextMode })}
            />
          </div>
        </fieldset>

        <VisualRange
          icon={<Gauge />}
          label={t("settings.lyricsView.sensitivity")}
          value={settings.visualizerSensitivityPercent}
          max={MAX_VISUALIZER_SENSITIVITY_PERCENT}
          disabled={!settings.enabled || !settings.visualizerEnabled}
          onChange={(visualizerSensitivityPercent) =>
            update({ visualizerSensitivityPercent })}
        />
        <VisualRange
          icon={<Expand />}
          label={t("settings.lyricsView.spread")}
          value={settings.spreadPercent}
          max={MAX_LYRICS_SPREAD_PERCENT}
          disabled={!settings.enabled}
          onChange={(spreadPercent) => update({ spreadPercent })}
        />
        <VisualRange
          icon={<Palette />}
          label={t("settings.lyricsView.color")}
          value={settings.colorStrengthPercent}
          max={MAX_LYRICS_COLOR_STRENGTH_PERCENT}
          disabled={!settings.enabled}
          onChange={(colorStrengthPercent) => update({ colorStrengthPercent })}
        />
      </div>
    </div>
  );
}

function AmbientModeOption({
  checked,
  label,
  mode,
  onChange,
}: {
  checked: boolean;
  label: string;
  mode: LyricsVisualSettings["mode"];
  onChange: (mode: LyricsVisualSettings["mode"]) => void;
}) {
  return (
    <label
      className="lyrics-visual-mode-option"
      data-selected={checked}
      data-mode={mode}
    >
      <input
        type="radio"
        name="lyrics-ambient-mode"
        value={mode}
        checked={checked}
        onChange={() => onChange(mode)}
      />
      <span className="lyrics-visual-mode-swatch" aria-hidden="true">
        <i />
        <b />
      </span>
      <span className="lyrics-visual-mode-copy">
        <strong>{label}</strong>
      </span>
    </label>
  );
}

function VisualRange({
  icon,
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={disabled ? "setting-row lyrics-visual-range disabled" : "setting-row lyrics-visual-range"}>
      <span className="setting-icon">{icon}</span>
      <span>
        <strong>{label}</strong>
      </span>
      <span className="lyrics-visual-range-control">
        <input
          type="range"
          min="0"
          max={max}
          step="5"
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <output>{value}%</output>
      </span>
    </label>
  );
}
