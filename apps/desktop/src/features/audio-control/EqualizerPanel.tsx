import { t } from "../../i18n";
import { Headphones, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useLessMotion } from "../motion/motionLevel";
import type { CSSProperties } from "react";
import type { DspSettings } from "../../types/tauri";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { EqualizerCurve } from "./EqualizerCurve";
import { applyEqualizerPreset, displayGain, EQ_FREQUENCIES, EQUALIZER_PRESETS } from "./equalizerPresets";

interface EqualizerPanelProps {
  settings: DspSettings;
  moduleEnabled: boolean;
  onChange: (settings: DspSettings) => void;
}

export function EqualizerPanel({ settings, moduleEnabled, onChange }: EqualizerPanelProps) {
  const reducedMotion = useLessMotion();
  const { localReady } = usePlaybackEngine();
  const active = moduleEnabled && settings.enabled;
  const highestBoost = Math.max(0, ...settings.bandsDb);
  const engineStatus = t(localReady ? active ? "audio.engine.dspLive" : "audio.engine.ready" : "audio.engine.waiting");

  const updateBand = (index: number, gain: number) => {
    onChange({
      ...settings,
      enabled: true,
      presetId: "custom",
      bandsDb: settings.bandsDb.map((value, bandIndex) => bandIndex === index ? gain : value),
    });
  };

  return (
    <motion.section
      className={`audio-panel equalizer-panel${active ? " is-enabled" : " is-disabled"}`}
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="audio-panel-header">
        <div className="audio-panel-title">
          <span className="audio-panel-icon"><SlidersHorizontal size={20} /></span>
          <div>
            <span className="eyebrow">Libre DSP</span>
            <h2>{t("audio.eq.title")}</h2>
            <p>{t("audio.eq.description")}</p>
          </div>
        </div>
        <div className="audio-panel-actions">
          <span className={`audio-engine-pill${localReady && active ? " is-live" : ""}`}>
            <span />{engineStatus}
          </span>
          <label className="audio-panel-toggle">
            <span>{t(settings.enabled ? "audio.on" : "audio.off")}</span>
            <span className="switch">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={!moduleEnabled}
                onChange={(event) => onChange({ ...settings, enabled: event.currentTarget.checked })}
                aria-label={t("audio.eq.toggle")}
              />
              <span />
            </span>
          </label>
        </div>
      </header>

      <div className="eq-presets" aria-label={t("audio.eq.presets")}>
        {EQUALIZER_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className={`ds-chip${settings.presetId === preset.id ? " is-active" : ""}`}
            aria-pressed={settings.presetId === preset.id}
            disabled={!moduleEnabled}
            onClick={() => onChange(applyEqualizerPreset({ ...settings, enabled: true }, preset))}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <EqualizerCurve bandsDb={settings.bandsDb} active={active} />

      <div className="eq-band-grid">
        {EQ_FREQUENCIES.map((frequency, index) => {
          const gain = settings.bandsDb[index] ?? 0;
          const fill = `${((gain + 12) / 24) * 100}%`;
          return (
            <label className="eq-band" key={frequency.hz}>
              <output>{displayGain(gain)}</output>
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={gain}
                disabled={!moduleEnabled}
                style={{ "--eq-fill": fill } as CSSProperties}
                aria-label={t("audio.eq.band", { frequency: frequency.label, gain: displayGain(gain) })}
                onChange={(event) => updateBand(index, Number(event.currentTarget.value))}
                onDoubleClick={() => updateBand(index, 0)}
              />
              <strong>{frequency.label}</strong>
              <small>{frequency.hz >= 1_000 ? "kHz" : "Hz"}</small>
            </label>
          );
        })}
      </div>

      <div className="eq-bottom-row">
        <label className="eq-preamp-control">
          <span><Headphones size={16} /><strong>{t("audio.eq.level")}</strong></span>
          <input
            type="range"
            min={-12}
            max={6}
            step={0.5}
            value={settings.preampDb}
            disabled={!moduleEnabled}
            onChange={(event) => onChange({ ...settings, enabled: true, preampDb: Number(event.currentTarget.value) })}
          />
          <output>{displayGain(settings.preampDb)} dB</output>
        </label>

        <AudioGuardToggle
          icon={<Sparkles size={16} />}
          label={t("audio.eq.headroom")}
          detail={settings.autoHeadroom && highestBoost > 0
            ? t("audio.eq.headroomReserve", { gain: highestBoost.toFixed(1) })
            : t("audio.eq.headroomHint")}
          checked={settings.autoHeadroom}
          disabled={!moduleEnabled}
          onChange={(autoHeadroom) => onChange({ ...settings, autoHeadroom })}
        />
        <AudioGuardToggle
          icon={<ShieldCheck size={16} />}
          label={t("audio.peak.title")}
          detail={settings.limiterEnabled
            ? t("audio.peak.protects")
            : t("audio.peak.unprotected")}
          checked={settings.limiterEnabled}
          disabled={!moduleEnabled}
          onChange={(limiterEnabled) => onChange({ ...settings, limiterEnabled })}
        />
        <button
          type="button"
          className="eq-reset-button"
          disabled={!moduleEnabled}
          onClick={() => onChange(applyEqualizerPreset({ ...settings, preampDb: 0 }, EQUALIZER_PRESETS[0]!))}
        >
          <RotateCcw size={15} /> {t("audio.eq.reset")}
        </button>
      </div>
    </motion.section>
  );
}

function AudioGuardToggle({ icon, label, detail, checked, disabled, onChange }: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="eq-guard-toggle">
      <span className="eq-guard-icon">{icon}</span>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <span className="switch">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} />
        <span />
      </span>
    </label>
  );
}
