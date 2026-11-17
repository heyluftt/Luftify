import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { t, type MessageKey } from "../../../i18n";
import { matchingNameColor } from "../color/color";
import { ColorPicker } from "../color/ColorPicker";
import { NAME_GRADIENTS } from "./nameGradients";
import { navigateChoices } from "./LookChoice";

type End = "from" | "to";

/**
 * The name gradient, independent of the profile colour: ready-made ones to
 * tap, or "from … to …" with own colours. Without a start it begins at the
 * profile colour, without an end at a matching neighbouring hue.
 */
export function NameGradientField({ on, from, to, base, disabled, onChange }: {
  on: boolean;
  from: string | null;
  to: string | null;
  /** The profile colour, where the gradient starts without its own colour. */
  base: string;
  disabled: boolean;
  onChange: (change: { nameGradient?: boolean; nameFrom?: string | null; nameColor?: string | null }) => void;
}) {
  const [editing, setEditing] = useState<End | null>(null);
  const start = from ?? base;
  const end = to ?? matchingNameColor(start);
  const preset = NAME_GRADIENTS.find((gradient) => gradient.from === from && gradient.to === to)?.key;

  return <div className="look-name-field">
    <label className="own-profile-toggle">
      <strong>{t("appearance.nameGradient")}</strong>
      <span className="switch"><input type="checkbox" checked={on} disabled={disabled}
        onChange={(event) => onChange({ nameGradient: event.currentTarget.checked })} /><span /></span>
    </label>
    {on && <>
      <div className="look-gradients" role="radiogroup" aria-label={t("profileLook.gradientPresets")} onKeyDown={navigateChoices}>
        <button type="button" role="radio" aria-checked={!from && !to} disabled={disabled}
          style={{ "--from": base, "--to": matchingNameColor(base) } as CSSProperties}
          onClick={() => { setEditing(null); onChange({ nameFrom: null, nameColor: null }); }}>
          <i aria-hidden="true" /><span>{t("profileLook.gradientAuto")}</span>
        </button>
        {NAME_GRADIENTS.map((gradient) => <button key={gradient.key} type="button" role="radio" aria-checked={preset === gradient.key} disabled={disabled}
          title={t(`profileLook.gradient.${gradient.key}` as MessageKey)} aria-label={t(`profileLook.gradient.${gradient.key}` as MessageKey)}
          style={{ "--from": gradient.from, "--to": gradient.to } as CSSProperties}
          onClick={() => { setEditing(null); onChange({ nameFrom: gradient.from, nameColor: gradient.to }); }}><i aria-hidden="true" /><span>{t(`profileLook.gradient.${gradient.key}` as MessageKey)}</span></button>)}
      </div>
      <div className="look-gradient-ends">
        {(["from", "to"] as const).map((side) => {
          const own = side === "from" ? from : to;
          return <button key={side} type="button" className="look-gradient-end" aria-expanded={editing === side} disabled={disabled}
            onClick={() => setEditing(editing === side ? null : side)}>
            <i style={{ background: side === "from" ? start : end }} aria-hidden="true" />
            <span><small>{t(side === "from" ? "profileLook.gradientFrom" : "profileLook.gradientTo")}</small>
              {own ?? t(side === "from" ? "profileLook.gradientFromAuto" : "profileLook.nameColorAuto")}</span>
          </button>;
        })}
        <button type="button" className="friends-icon-button look-gradient-swap" disabled={disabled}
          title={t("profileLook.gradientSwap")} aria-label={t("profileLook.gradientSwap")}
          onClick={() => onChange({ nameFrom: end, nameColor: start })}><ArrowLeftRight size={16} aria-hidden="true" /></button>
      </div>
      {editing && <div className="look-gradient-editor">
        <ColorPicker value={editing === "from" ? start : end} disabled={disabled}
          onChange={(hex) => onChange(editing === "from" ? { nameFrom: hex } : { nameColor: hex })} />
        {(editing === "from" ? from : to) && <button type="button" className="text-button" disabled={disabled}
          onClick={() => onChange(editing === "from" ? { nameFrom: null } : { nameColor: null })}>
          <RotateCcw size={13} aria-hidden="true" />{t(editing === "from" ? "profileLook.gradientFromReset" : "profileLook.gradientToReset")}
        </button>}
      </div>}
    </>}
  </div>;
}
