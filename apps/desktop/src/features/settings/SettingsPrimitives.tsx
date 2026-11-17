import { Monitor, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SettingsSelect } from "./SettingsSelect";

export function SectionHeading({ index, title, description }: { index: string; title: string; description?: string }) {
  return (
    <header className="settings-section-heading">
      <span aria-hidden="true">{index}</span>
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    </header>
  );
}

export function SettingsGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="settings-group">
      <div className="settings-group-heading">
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </div>
      {children}
    </div>
  );
}

export function ToggleRow({
  icon: Icon = Monitor,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon?: LucideIcon;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={disabled ? "setting-row disabled" : "setting-row"}>
      <span className="setting-icon"><Icon /></span>
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <span className="switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span />
      </span>
    </label>
  );
}

export function SelectRow<T extends string>({
  icon: Icon = Monitor,
  label,
  description,
  value,
  onChange,
  children,
  disabled = false,
}: {
  icon?: LucideIcon;
  label: string;
  description?: string;
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="setting-row setting-select">
      <span className="setting-icon"><Icon /></span>
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <SettingsSelect disabled={disabled} label={label} value={value} onChange={(next) => onChange(next as T)}>
        {children}
      </SettingsSelect>
    </div>
  );
}
