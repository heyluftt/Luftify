import type { ReactNode } from "react";

export function SpatialSlider({ icon, label, detail, value, min, max, step, suffix, decimals = 0, disabled, onChange }: {
  icon: ReactNode;
  label: string;
  detail: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  decimals?: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="spatial-slider">
      <span className="spatial-slider-icon">{icon}</span>
      <span className="spatial-slider-copy"><strong>{label}</strong><small>{detail}</small></span>
      <output>{value.toFixed(decimals)} {suffix}</output>
      <input aria-label={label} aria-valuetext={value.toFixed(decimals) + " " + suffix} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.currentTarget.value))} />
    </label>
  );
}
