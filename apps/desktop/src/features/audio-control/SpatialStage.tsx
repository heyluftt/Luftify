import { Headphones } from "lucide-react";
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import type { SpatialSettings } from "../../types/tauri";
import { SPATIAL_PRESETS } from "./spatialPresets";
import { t } from "../../i18n";

export function SpatialStage({ settings, active, reducedMotion }: {
  settings: SpatialSettings;
  active: boolean;
  reducedMotion: boolean;
}) {
  const strength = settings.mixPercent / 30;
  const style = { "--space-strength": strength } as CSSProperties;
  return (
    <div className={`spatial-stage${active ? " is-active" : ""}`} style={style} aria-hidden="true">
      {[0, 1, 2].map((ring) => (
        <motion.span
          className={`spatial-ring ring-${ring + 1}`}
          key={ring}
          animate={{ scale: 0.88 + strength * (0.15 + ring * 0.035), opacity: active ? 0.24 + strength * 0.4 : 0.12 }}
          transition={{ duration: reducedMotion ? 0 : 0.38, ease: "easeOut" }}
        />
      ))}
      <span className="spatial-source is-left" />
      <span className="spatial-source is-right" />
      <span className="spatial-listener"><Headphones size={22} /></span>
      <div className="spatial-stage-copy">
        <strong>{active ? settings.presetId === "custom" ? t("spatial.custom") : SPATIAL_PRESETS.find((preset) => preset.presetId === settings.presetId)?.name ?? t("spatial.active") : t("spatial.directSignal")}</strong>
        <small>{active ? t("spatial.summary", { mix: Math.round(settings.mixPercent), decay: settings.decaySeconds.toFixed(2) }) : t("spatial.unchanged")}</small>
      </div>
    </div>
  );
}

