import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { t } from "../../../i18n";
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "./color";

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A colour field (saturation to the right, brightness upwards), a hue slider
 * and the colour code. Dragging, arrow keys (with Shift in bigger steps) and
 * typing a code all work.
 */
export function ColorPicker({ value, onChange, disabled }: { value: string; onChange: (hex: string) => void; disabled?: boolean }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [code, setCode] = useState(value);
  const field = useRef<HTMLDivElement>(null);
  // Outside changes (a preset, another picker) move the controls; the hue of
  // a grey stays where it was.
  useEffect(() => {
    setCode(value);
    setHsv((current) => hsvToHex(current) === value ? current : { ...hexToHsv(value), ...(hexToHsv(value).s === 0 ? { h: current.h } : {}) });
  }, [value]);

  const pick = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setCode(hex);
    if (hex !== value) onChange(hex);
  };
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = field.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    pick({ h: hsv.h, s: clamp((event.clientX - rect.left) / rect.width), v: clamp(1 - (event.clientY - rect.top) / rect.height) });
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    pick({ h: hsv.h, s: clamp(hsv.s + move[0]), v: clamp(hsv.v + move[1]) });
  };

  return <div className="color-picker" data-disabled={disabled || undefined} style={{ "--picker-hue": `${hsv.h}`, "--picker-color": value } as CSSProperties}>
    <div ref={field} className="color-picker-field" role="slider" tabIndex={disabled ? -1 : 0} aria-label={t("profileLook.shade")}
      aria-valuetext={`${Math.round(hsv.s * 100)} %, ${Math.round(hsv.v * 100)} %`} aria-disabled={disabled || undefined}
      onKeyDown={disabled ? undefined : onKey}
      onPointerDown={disabled ? undefined : (event) => { event.currentTarget.setPointerCapture(event.pointerId); fromPointer(event); }}
      onPointerMove={disabled ? undefined : (event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event); }}>
      <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
    </div>
    <input className="color-picker-hue" type="range" min={0} max={359} value={Math.round(hsv.h)} disabled={disabled}
      aria-label={t("profileLook.hue")} onChange={(event) => pick({ ...hsv, h: Number(event.currentTarget.value), s: hsv.s || 0.6, v: hsv.v || 0.9 })} />
    <div className="color-picker-code">
      <span aria-hidden="true" />
      <input value={code} maxLength={7} spellCheck={false} disabled={disabled} aria-label={t("profileLook.hex")}
        onChange={(event) => {
          setCode(event.currentTarget.value);
          const hex = normalizeHex(event.currentTarget.value);
          if (hex) { setHsv(hexToHsv(hex)); onChange(hex); }
        }}
        onBlur={() => setCode(value)} />
    </div>
  </div>;
}
