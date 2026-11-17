import { t } from "../../i18n";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  AudioLines,
  Check,
  CircleAlert,
  SlidersHorizontal,
  Volume1,
  Volume2,
  VolumeX,
  Waves,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { desktopApi } from "../../services/desktopApi";
import type { AudioControlSettings, Settings } from "../../types/tauri";
import { volumeCoordinator } from "../playback/VolumeCommandCoordinator";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import {
  effectiveDsp,
  setAudioPreset,
  setRuntimeAudioControlSettings,
} from "./audioControl";
import {
  applyEqualizerPreset,
  EQUALIZER_PRESETS,
} from "./equalizerPresets";
import {
  applySpatialPreset,
  SPATIAL_PRESETS,
} from "./spatialPresets";
import {
  DEFAULT_VOLUME_BOOST_PERCENT,
  volumeBoostDbFromPercent,
  volumeBoostPercentFromDb,
} from "./volumeBoost";
import { VolumeBoostSlider } from "./VolumeBoostSlider";
import { VolumeSlider } from "./VolumeSlider";
import { SettingsSelect } from "../settings/SettingsSelect";

interface AudioQuickSettingsProps {
  connected: boolean;
  muted: boolean;
  onClose: () => void;
  settings: AudioControlSettings;
  volume: number;
}

type SaveState = "idle" | "saved" | "saving" | "error";

export function AudioQuickSettings({
  connected,
  muted,
  onClose,
  settings,
  volume,
}: AudioQuickSettingsProps) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { localReady } = usePlaybackEngine();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  const hideSaved = useRef(0);
  const activeStages = Number(settings.dsp.enabled)
    + Number(settings.dsp.spatial.enabled)
    + Number(settings.dsp.volumeBoostEnabled && settings.dsp.volumeBoostDb > 0);
  const eqPreset = EQUALIZER_PRESETS.find((preset) => preset.id === settings.dsp.presetId);
  const spatialPreset = SPATIAL_PRESETS.find((preset) => preset.presetId === settings.dsp.spatial.presetId);
  const volumeBoostPercent = volumeBoostPercentFromDb(settings.dsp.volumeBoostDb);
  const volumeIcon = muted || volume === 0
    ? <VolumeX size={17} />
    : volume < 0.55
      ? <Volume1 size={17} />
      : <Volume2 size={17} />;

  useEffect(() => () => window.clearTimeout(hideSaved.current), []);

  const persist = (next: AudioControlSettings, saveAll = false) => {
    const revision = ++saveRevision.current;
    window.clearTimeout(hideSaved.current);
    setSaveState("saving");
    preview(next);
    const task = saveChain.current
      .catch(() => undefined)
      .then(async () => {
        if (saveAll) {
          const current = client.getQueryData<Settings>(["settings"])
            ?? await desktopApi.settings();
          await desktopApi.saveSettings({ ...current, audioControl: next });
          await client.invalidateQueries({ queryKey: ["modules"] });
          return;
        }
        await desktopApi.saveDspSettings(next.dsp);
      });
    saveChain.current = task;
    void task.then(
      () => {
        if (saveRevision.current !== revision) return;
        setSaveState("saved");
        hideSaved.current = window.setTimeout(() => {
          if (saveRevision.current === revision) setSaveState("idle");
        }, 1400);
      },
      () => {
        if (saveRevision.current !== revision) return;
        setSaveState("error");
        void client.invalidateQueries({ queryKey: ["settings"] });
      },
    );
    return task;
  };

  const preview = (next: AudioControlSettings) => {
    setRuntimeAudioControlSettings(next);
    client.setQueryData<Settings>(["settings"], (current) => current
      ? { ...current, audioControl: next }
      : current);
    void desktopApi.previewDspSettings(effectiveDsp(next));
  };

  const withBoostPercent = (percent: number): AudioControlSettings => ({
    ...settings,
    dsp: {
      ...settings.dsp,
      volumeBoostEnabled: percent > 100,
      volumeBoostDb: volumeBoostDbFromPercent(percent),
    },
  });

  const openFullPage = () => {
    onClose();
    navigate("/modules/audio-control");
  };

  return (
    <section id="audio-quick-settings" className="audio-popover audio-quick-settings" role="dialog" aria-label={t("audio.quick.label")}>
      <header className="audio-quick-header">
        <span className="audio-quick-heading-icon"><AudioLines size={17} /></span>
        <span className="audio-quick-heading-copy">
          <strong>{t("audio.quick.title")}</strong>
          <small>{quickStatus(settings, true, localReady, activeStages)}</small>
        </span>
        <button
          type="button"
          className="icon-button"
          disabled={!connected}
          aria-label={t(muted ? "player.unmute" : "player.mute")}
          onClick={() => void volumeCoordinator.toggleMute()}
        >
          {volumeIcon}
        </button>
      </header>

      <div className="audio-quick-volume">
        <VolumeSlider settings={settings} showPercentage />
        <div className="audio-preset-row" aria-label={t("player.volumePresets")}>
          {settings.presets.map((preset, index) => (
            <button
              type="button"
              key={`${preset}-${index}`}
              disabled={!connected}
              onClick={() => setAudioPreset(preset, settings.curve)}
            >
              {preset}%
            </button>
          ))}
        </div>
      </div>

      <label className="audio-quick-master">
        <span>
          <strong>{t("audio.quick.module")}</strong>
          <small>{t("audio.quick.moduleHint")}</small>
        </span>
        <span className="switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => persist({ ...settings, enabled: event.currentTarget.checked }, true)}
          />
          <span />
        </span>
      </label>

      <div className="audio-quick-dsp-grid">
        <QuickStage
          active={settings.enabled && settings.dsp.enabled}
          disabled={!settings.enabled}
          icon={<SlidersHorizontal size={16} />}
          label={t("audio.eq.title")}
          onToggle={(enabled) => persist({
            ...settings,
            dsp: { ...settings.dsp, enabled },
          })}
          selectLabel={t("audio.quick.eqPreset")}
          selectValue={settings.dsp.presetId}
          onSelect={(presetId) => {
            const preset = EQUALIZER_PRESETS.find((item) => item.id === presetId);
            if (!preset) return;
            persist({
              ...settings,
              dsp: applyEqualizerPreset({ ...settings.dsp, enabled: true }, preset),
            });
          }}
          unknownOption={eqPreset ? undefined : t("audio.quick.customEq")}
          options={EQUALIZER_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))}
        />

        <QuickStage
          active={settings.enabled && settings.dsp.spatial.enabled}
          disabled={!settings.enabled}
          icon={<Waves size={16} />}
          label={t("spatial.title")}
          onToggle={(enabled) => {
            const spatial = enabled && settings.dsp.spatial.presetId === "direct"
              ? applySpatialPreset(SPATIAL_PRESETS[1]!)
              : { ...settings.dsp.spatial, enabled };
            persist({ ...settings, dsp: { ...settings.dsp, spatial } });
          }}
          selectLabel={t("spatial.presets")}
          selectValue={settings.dsp.spatial.presetId}
          onSelect={(presetId) => {
            const preset = SPATIAL_PRESETS.find((item) => item.presetId === presetId);
            if (!preset) return;
            persist({
              ...settings,
              dsp: { ...settings.dsp, spatial: applySpatialPreset(preset) },
            });
          }}
          unknownOption={spatialPreset ? undefined : t("spatial.custom")}
          options={SPATIAL_PRESETS.map((preset) => ({ value: preset.presetId, label: preset.name }))}
        />

        <QuickStage
          wide
          active={settings.enabled && settings.dsp.volumeBoostEnabled && settings.dsp.volumeBoostDb > 0}
          disabled={!settings.enabled}
          icon={<Zap size={16} />}
          label={t("audio.boost.title")}
          onToggle={(volumeBoostEnabled) => persist({
            ...settings,
            dsp: {
              ...settings.dsp,
              volumeBoostEnabled,
              volumeBoostDb: volumeBoostEnabled && volumeBoostPercent === 100
                ? volumeBoostDbFromPercent(DEFAULT_VOLUME_BOOST_PERCENT)
                : settings.dsp.volumeBoostDb,
            },
          })}
        >
          <VolumeBoostSlider
            disabled={!settings.enabled}
            settings={settings}
            value={volumeBoostPercent}
            onPreview={(percent) => preview(withBoostPercent(percent))}
            onCommit={(percent) => persist(withBoostPercent(percent))}
          />
        </QuickStage>
      </div>

      <footer className="audio-quick-footer">
        {saveState !== "idle" && (
          <span className={`audio-quick-save-state is-${saveState}`}>
            {saveState === "error" ? <CircleAlert size={13} /> : saveState === "saved" ? <Check size={13} /> : null}
            {t(saveState === "saving" ? "audio.quick.saving" : saveState === "error" ? "audio.quick.saveFailed" : "audio.quick.saved")}
          </span>
        )}
        <button type="button" className="text-button" onClick={openFullPage}>
          {t("audio.quick.allSettings")}
          <ArrowRight size={14} />
        </button>
      </footer>
    </section>
  );
}

function QuickStage({
  active,
  disabled,
  icon,
  label,
  onSelect,
  onToggle,
  options,
  selectLabel,
  selectValue,
  unknownOption,
  children,
  wide = false,
}: {
  active: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onSelect?: (value: string) => void;
  onToggle: (enabled: boolean) => void;
  options?: Array<{ label: string; value: string }>;
  selectLabel?: string;
  selectValue?: string;
  unknownOption?: string | undefined;
  children?: ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`audio-quick-stage${wide ? " is-wide" : ""}`} data-active={active}>
      <div className="audio-quick-stage-heading">
        <span>{icon}</span>
        <strong>{label}</strong>
        <label className="switch">
          <input
            type="checkbox"
            checked={active}
            disabled={disabled}
            aria-label={t("audio.quick.toggleStage", { label })}
            onChange={(event) => onToggle(event.currentTarget.checked)}
          />
          <span />
        </label>
      </div>
      {children ?? (
        <SettingsSelect
          compact
          label={selectLabel ?? label}
          value={selectValue ?? ""}
          disabled={disabled}
          onChange={(value) => onSelect?.(value)}
        >
          {unknownOption && <option value={selectValue}>{unknownOption}</option>}
          {options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </SettingsSelect>
      )}
    </article>
  );
}

function quickStatus(
  settings: AudioControlSettings,
  libreSelected: boolean,
  libreReady: boolean,
  activeStages: number,
): string {
  if (!settings.enabled) return t("audio.status.moduleOff");
  if (!libreSelected) return t("audio.status.libreOnly");
  if (!libreReady) return t("audio.status.preparing");
  if (activeStages === 1) return t("audio.status.oneStage");
  if (activeStages > 1) return t("audio.status.stages", { count: activeStages });
  return t("audio.status.direct");
}
