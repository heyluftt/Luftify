import { Pipette } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { t } from "../../../i18n";
import { PROFILE_ACCENTS, accentLabel } from "../appearance";
import { ACCENT_HEX, nearestAccent } from "../color/color";
import { ColorPicker } from "../color/ColorPicker";
import { navigateChoices } from "./LookChoice";

/**
 * Profile colour: a preset, or an own colour. The picker only opens on the
 * own swatch and closes again with it (older apps show the nearest preset).
 */
export function ProfileColorField({ accent, color, disabled, onChange }: {
  accent: string;
  color: string | null;
  disabled: boolean;
  onChange: (change: { accent: string; color: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  return <div className="look-color-field">
    <div className="look-color-presets" role="radiogroup" aria-label={t("profileLook.color")} onKeyDown={navigateChoices}>
      {PROFILE_ACCENTS.map((key) => <button key={key} type="button" role="radio" data-badge-color={key}
        aria-checked={!color && accent === key} aria-label={t(accentLabel(key))} title={t(accentLabel(key))} disabled={disabled}
        onClick={() => { setOpen(false); onChange({ accent: key, color: null }); }} style={{ "--swatch": ACCENT_HEX[key] } as CSSProperties}><i aria-hidden="true" /><span>{t(accentLabel(key))}</span></button>)}
    </div>
    <div className="look-color-custom">
      <div className="look-swatches" role="radiogroup" aria-label={t("profileLook.colorOwn")}>
      <OwnSwatch color={color} open={open} disabled={disabled} onClick={() => {
        setOpen(!open);
        if (!color) onChange({ accent, color: ACCENT_HEX[accent] ?? ACCENT_HEX.sky! });
      }} />
      </div>
      <button type="button" className="text-button" disabled={disabled} aria-expanded={open} onClick={() => {
        setOpen(!open);
        if (!color) onChange({ accent, color: ACCENT_HEX[accent] ?? ACCENT_HEX.sky! });
      }}>{t("profileLook.colorOwn")}{color && <code>{color}</code>}</button>
    </div>
    {open && color && <ColorPicker value={color} disabled={disabled} onChange={(hex) => onChange({ accent: nearestAccent(hex), color: hex })} />}
  </div>;
}

/** The swatch for an own colour: filled with it when chosen, a pipette otherwise. */
export function OwnSwatch({ color, open, disabled, label = t("profileLook.colorOwn"), onClick }: {
  color: string | null;
  open: boolean;
  disabled: boolean;
  label?: string;
  onClick: () => void;
}) {
  return <button type="button" role="radio" className="look-swatch-own" aria-checked={Boolean(color)} aria-expanded={open} disabled={disabled}
    title={label} aria-label={label} onClick={onClick} style={color ? { "--own-color": color } as CSSProperties : undefined}>
    <i aria-hidden="true" /><Pipette size={13} aria-hidden="true" />
  </button>;
}
