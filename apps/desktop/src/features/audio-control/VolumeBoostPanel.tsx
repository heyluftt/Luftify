import { t } from "../../i18n";
import { Gauge, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useLessMotion } from "../motion/motionLevel";
import type { CSSProperties } from "react";

import type { DspSettings } from "../../types/tauri";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import {
  DEFAULT_VOLUME_BOOST_PERCENT,
  MAX_VOLUME_BOOST_PERCENT,
  MIN_VOLUME_BOOST_PERCENT,
  VOLUME_BOOST_PERCENT_PRESETS,
  volumeBoostDbFromPercent,
  volumeBoostPercentFromDb,
} from "./volumeBoost";

interface VolumeBoostPanelProps {
  moduleEnabled: boolean;
  onChange: (settings: DspSettings) => void;
  settings: DspSettings;
}

export function VolumeBoostPanel({ moduleEnabled, onChange, settings }: VolumeBoostPanelProps) {
  const reducedMotion = useLessMotion();
  const { localReady } = usePlaybackEngine();
  const boostPercent = volumeBoostPercentFromDb(settings.volumeBoostDb);
  const active = moduleEnabled && settings.volumeBoostEnabled && boostPercent > MIN_VOLUME_BOOST_PERCENT;
  const peakProtectionActive = moduleEnabled && settings.limiterEnabled;
  const engineStatus = t(localReady ? active ? "audio.engine.boostLive" : "audio.engine.ready" : "audio.engine.waiting");
  const character = boostPercent <= 150
    ? t("audio.boost.gentle")
    : boostPercent < 250
      ? t("audio.boost.louder")
      : t("audio.boost.high");

  const setBoost = (percent: number) => onChange({
    ...settings,
    volumeBoostDb: volumeBoostDbFromPercent(percent),
    volumeBoostEnabled: percent > MIN_VOLUME_BOOST_PERCENT,
  });

  return (
    <motion.section
      className={`audio-panel volume-boost-panel${active ? " is-enabled" : " is-disabled"}`}
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="audio-panel-header">
        <div className="audio-panel-title">
          <span className="audio-panel-icon"><Gauge size={20} /></span>
          <div>
            <span className="eyebrow">{t("audio.boost.eyebrow")}</span>
            <h2>{t("audio.boost.title")}</h2>
            <p>{t("audio.boost.description")}</p>
          </div>
        </div>
        <div className="audio-panel-actions">
          <span className={`audio-engine-pill${localReady && active ? " is-live" : ""}`}>
            <span />{engineStatus}
          </span>
          <label className="audio-panel-toggle">
            <span>{t(settings.volumeBoostEnabled ? "audio.on" : "audio.off")}</span>
            <span className="switch">
              <input
                type="checkbox"
                checked={settings.volumeBoostEnabled}
                disabled={!moduleEnabled}
                aria-label={t("audio.boost.toggle")}
                onChange={(event) => onChange({
                  ...settings,
                  volumeBoostEnabled: event.currentTarget.checked,
                  volumeBoostDb: event.currentTarget.checked && boostPercent === MIN_VOLUME_BOOST_PERCENT
                    ? volumeBoostDbFromPercent(DEFAULT_VOLUME_BOOST_PERCENT)
                    : settings.volumeBoostDb,
                })}
              />
              <span />
            </span>
          </label>
        </div>
      </header>

      <div className="boost-workbench">
        <div className="boost-readout">
          <span className="boost-readout-icon"><Sparkles size={16} /></span>
          <span><small>{t("audio.boost.total")}</small><strong>{boostPercent}%</strong></span>
          <output>{t("audio.boost.amount", { percent: boostPercent - MIN_VOLUME_BOOST_PERCENT })}</output>
        </div>

        <div className="boost-control">
          <input
            type="range"
            min={MIN_VOLUME_BOOST_PERCENT}
            max={MAX_VOLUME_BOOST_PERCENT}
            step={1}
            value={boostPercent}
            disabled={!moduleEnabled}
            aria-label={t("audio.boost.slider", { percent: boostPercent })}
            style={{ "--boost-fill": `${((boostPercent - MIN_VOLUME_BOOST_PERCENT) / (MAX_VOLUME_BOOST_PERCENT - MIN_VOLUME_BOOST_PERCENT)) * 100}%` } as CSSProperties}
            onChange={(event) => setBoost(Number(event.currentTarget.value))}
          />
          <div className="boost-scale" aria-hidden="true"><span>100%</span><span>200%</span><span>300%</span></div>
        </div>

        <div className="boost-presets" aria-label={t("audio.boost.presets")}>
          {VOLUME_BOOST_PERCENT_PRESETS.map((value) => (
            <button
              type="button"
              key={value}
              className={`ds-chip${settings.volumeBoostEnabled && boostPercent === value ? " is-active" : ""}`}
              disabled={!moduleEnabled}
              onClick={() => setBoost(value)}
            >
              {value}%
            </button>
          ))}
        </div>
      </div>

      {/* Same setting as in the equalizer; overdriving is usually wanted here. */}
      <label className="boost-safety">
        <span><ShieldCheck size={15} /></span>
        <span>
          <strong>{t(peakProtectionActive ? "audio.peak.on" : "audio.peak.off")}</strong>
          <small>{peakProtectionActive ? character : t("audio.boost.noLimiter")}</small>
        </span>
        <small>{peakProtectionActive
          ? `${t("audio.peak.protects")}.`
          : t("audio.boost.overload")}</small>
        <span className="switch">
          <input
            type="checkbox"
            checked={settings.limiterEnabled}
            disabled={!moduleEnabled}
            aria-label={t("audio.peak.title")}
            onChange={(event) => onChange({ ...settings, limiterEnabled: event.currentTarget.checked })}
          />
          <span />
        </span>
      </label>
    </motion.section>
  );
}
