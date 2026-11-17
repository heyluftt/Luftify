import { Clock3, Gauge, MoveHorizontal, Waves } from "lucide-react";
import { motion } from "motion/react";
import { useLessMotion } from "../motion/motionLevel";
import { SpatialStage } from "./SpatialStage";
import { SpatialSlider } from "./SpatialSlider";
import { t } from "../../i18n";
import type { SpatialSettings } from "../../types/tauri";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { applySpatialPreset, SPATIAL_PRESETS } from "./spatialPresets";

export function SpatialAudioPanel({ settings, moduleEnabled, auditionBypassed = false, onChange }: {
  settings: SpatialSettings;
  moduleEnabled: boolean;
  auditionBypassed?: boolean;
  onChange: (settings: SpatialSettings) => void;
}) {
  const reducedMotion = useLessMotion();
  const { localReady } = usePlaybackEngine();
  const cabin = settings.cabinMode || settings.presetId === "car";
  const active = !auditionBypassed && moduleEnabled && settings.enabled && localReady;
  const engineStatus = localReady ? active ? t("spatial.live") : t("spatial.ready") : t("spatial.waiting");
  const update = (change: Partial<SpatialSettings>) => onChange({
    ...settings,
    ...change,
    enabled: true,
    presetId: "custom",
    cabinMode: settings.cabinMode ?? settings.presetId === "car",
  });

  return (
    <motion.section
      className={`audio-panel spatial-panel${active ? " is-enabled" : " is-disabled"}`}
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.34, delay: reducedMotion ? 0 : 0.04, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="audio-panel-header">
        <div className="audio-panel-title">
          <span className="audio-panel-icon"><Waves size={21} /></span>
          <div>
            <span className="eyebrow">{t("spatial.eyebrow")}</span>
            <h2>{t("spatial.title")}</h2>
            <p>{t("spatial.description")}</p>
          </div>
        </div>
        <div className="audio-panel-actions">
          <span className={`audio-engine-pill${localReady && active ? " is-live" : ""}`}>
            <span />{engineStatus}
          </span>
          <label className="audio-panel-toggle">
            <span>{settings.enabled ? t("spatial.on") : t("spatial.off")}</span>
            <span className="switch">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={!moduleEnabled}
                onChange={(event) => onChange(event.currentTarget.checked && settings.presetId === "direct" ? applySpatialPreset(SPATIAL_PRESETS[1]!) : { ...settings, enabled: event.currentTarget.checked })}
                aria-label={t("spatial.toggle")}
              />
              <span />
            </span>
          </label>
        </div>
      </header>

      <div className="spatial-preset-grid" aria-label={t("spatial.presets")}>
        {SPATIAL_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.presetId}
            className={settings.presetId === preset.presetId ? "is-active" : ""}
            aria-pressed={settings.presetId === preset.presetId}
            disabled={!moduleEnabled}
            onClick={() => onChange(applySpatialPreset(preset))}
          >
            <strong>{preset.name}</strong><small>{preset.description}</small>
          </button>
        ))}
      </div>

      <div className="spatial-workspace">
        <SpatialStage settings={settings} active={active} reducedMotion={Boolean(reducedMotion)} />
        <div className="spatial-controls">
          <SpatialSlider
            icon={<Waves size={15} />}
            label={t("spatial.mix")}
            detail={t(cabin ? "spatial.car.mixHint" : "spatial.mixHint")}
            value={settings.mixPercent}
            min={0}
            max={30}
            step={1}
            suffix="%"
            disabled={!moduleEnabled}
            onChange={(mixPercent) => update({ mixPercent })}
          />
          <SpatialSlider
            icon={<Clock3 size={15} />}
            label={t("spatial.decay")}
            detail={t("spatial.decayHint")}
            value={settings.decaySeconds}
            min={0.35}
            max={5.5}
            step={0.05}
            suffix="s"
            decimals={2}
            disabled={!moduleEnabled}
            onChange={(decaySeconds) => update({ decaySeconds })}
          />
          <SpatialSlider
            icon={<MoveHorizontal size={15} />}
            label={t("spatial.width")}
            detail={t("spatial.widthHint")}
            value={settings.stereoWidthPercent}
            min={50}
            max={150}
            step={1}
            suffix="%"
            disabled={!moduleEnabled}
            onChange={(stereoWidthPercent) => update({ stereoWidthPercent })}
          />
        </div>
      </div>

      <p className="spatial-model-note">{t(cabin ? "spatial.car.note" : "spatial.note")}</p>
      <details className="spatial-fine-tuning">
        <summary><Gauge size={15} /> {t("spatial.fine")}</summary>
        <div>
          <SpatialSlider
            icon={<Clock3 size={14} />}
            label={t("spatial.predelay")}
            detail={t("spatial.predelayHint")}
            value={settings.preDelayMs}
            min={0}
            max={80}
            step={1}
            suffix="ms"
            disabled={!moduleEnabled}
            onChange={(preDelayMs) => update({ preDelayMs })}
          />
          <SpatialSlider
            icon={<Gauge size={14} />}
            label={t("spatial.damping")}
            detail={t("spatial.dampingHint")}
            value={settings.dampingPercent}
            min={0}
            max={100}
            step={1}
            suffix="%"
            disabled={!moduleEnabled}
            onChange={(dampingPercent) => update({ dampingPercent })}
          />
        </div>
      </details>
    </motion.section>
  );
}
