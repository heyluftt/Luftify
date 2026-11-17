import type { CSSProperties } from "react";
import { t } from "../../i18n";
import { usePlayback } from "../playback/usePlayback";
import { volumeCoordinator } from "../playback/VolumeCommandCoordinator";
import { mappedVolume, spotifyToUi } from "./audioControl";
import type { AudioControlSettings } from "../../types/tauri";
import { useSmoothVolumeWheel } from "./useSmoothVolumeWheel";

export function VolumeSlider({
  settings,
  large = false,
  compact = false,
  showPercentage = false,
  ariaLabel = t("audio.volume"),
}: {
  settings: AudioControlSettings;
  large?: boolean;
  compact?: boolean;
  showPercentage?: boolean;
  ariaLabel?: string;
}) {
  const { playback, connected } = usePlayback();
  const uiValue = playback?.isMuted
    ? 0
    : spotifyToUi(playback?.volume ?? 0, settings.enabled ? settings.curve : "linear");
  const curve = settings.enabled ? settings.curve : "linear";
  const change = (value: number, createdAtMs = Date.now()) => volumeCoordinator.changeMapped(mappedVolume(value, curve), createdAtMs);
  const wheel = useSmoothVolumeWheel({
    enabled: settings.enabled && settings.wheelEnabled && connected,
    stepPercent: settings.stepPercent,
    value: uiValue,
    onChange: (value) => volumeCoordinator.setMapped(mappedVolume(value, curve), Date.now()),
    onCommit: () => volumeCoordinator.whenIdle(),
  });
  const className = [
    "volume-slider-control",
    large ? "large" : "",
    compact ? "compact" : "",
    wheel.isWheelAdjusting ? "is-wheel-adjusting" : "",
  ].filter(Boolean).join(" ");

  return <div className={className}>
    <input
      disabled={!connected}
      aria-label={ariaLabel}
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={wheel.displayValue}
      style={{ "--volume": `${Math.round(wheel.displayValue * 100)}%` } as CSSProperties}
      onPointerDown={(event) => {
        wheel.stopWheelPreview();
        volumeCoordinator.beginDrag();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic and legacy pointers may not support capture */ }
      }}
      onInput={(event) => change(Number(event.currentTarget.value), Date.now())}
      onPointerUp={() => volumeCoordinator.commit()}
      onPointerCancel={() => volumeCoordinator.cancelDrag()}
      onLostPointerCapture={() => volumeCoordinator.cancelDrag()}
      onBlur={() => volumeCoordinator.cancelDrag()}
      onWheel={wheel.onWheel}
    />
    {showPercentage && <output>{Math.round(wheel.displayValue * 100)}%</output>}
  </div>;
}
