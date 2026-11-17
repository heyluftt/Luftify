import { t } from "../../i18n";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import type { AudioControlSettings } from "../../types/tauri";
import { useSmoothVolumeWheel } from "./useSmoothVolumeWheel";
import {
  MAX_VOLUME_BOOST_PERCENT,
  MIN_VOLUME_BOOST_PERCENT,
  clampVolumeBoostPercent,
} from "./volumeBoost";

interface VolumeBoostSliderProps {
  disabled: boolean;
  onCommit: (percent: number) => Promise<void> | void;
  onPreview: (percent: number) => void;
  settings: Pick<AudioControlSettings, "enabled" | "stepPercent" | "wheelEnabled">;
  value: number;
}

export function VolumeBoostSlider({
  disabled,
  onCommit,
  onPreview,
  settings,
  value,
}: VolumeBoostSliderProps) {
  const latestValue = useRef(value);
  const dragging = useRef(false);
  const [dragValue, setDragValue] = useState<number>();

  useEffect(() => {
    if (!dragging.current) latestValue.current = value;
  }, [value]);

  const preview = useCallback((nextValue: number) => {
    const percent = clampVolumeBoostPercent(nextValue);
    latestValue.current = percent;
    onPreview(percent);
  }, [onPreview]);

  const wheel = useSmoothVolumeWheel({
    enabled: !disabled && settings.enabled && settings.wheelEnabled,
    stepPercent: settings.stepPercent,
    value,
    minimum: MIN_VOLUME_BOOST_PERCENT,
    maximum: MAX_VOLUME_BOOST_PERCENT,
    wheelStep: settings.stepPercent,
    onChange: preview,
    onCommit: () => onCommit(latestValue.current),
  });

  const commitDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setDragValue(undefined);
    void onCommit(latestValue.current);
  };
  const displayValue = dragValue ?? wheel.displayValue;

  return (
    <div className={`volume-slider-control volume-boost-slider${wheel.isWheelAdjusting ? " is-wheel-adjusting" : ""}`}>
      <input
        disabled={disabled}
        aria-label={t("audio.boost.title")}
        type="range"
        min={MIN_VOLUME_BOOST_PERCENT}
        max={MAX_VOLUME_BOOST_PERCENT}
        step={1}
        value={displayValue}
        style={{ "--volume": `${((displayValue - MIN_VOLUME_BOOST_PERCENT) / (MAX_VOLUME_BOOST_PERCENT - MIN_VOLUME_BOOST_PERCENT)) * 100}%` } as CSSProperties}
        onPointerDown={(event) => {
          wheel.stopWheelPreview();
          dragging.current = true;
          latestValue.current = displayValue;
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is unavailable in some test and legacy environments. */ }
        }}
        onInput={(event) => {
          const percent = clampVolumeBoostPercent(Number(event.currentTarget.value));
          setDragValue(percent);
          preview(percent);
        }}
        onPointerUp={commitDrag}
        onPointerCancel={commitDrag}
        onLostPointerCapture={commitDrag}
        onBlur={commitDrag}
        onWheel={wheel.onWheel}
      />
      <output>{Math.round(displayValue)}%</output>
    </div>
  );
}
