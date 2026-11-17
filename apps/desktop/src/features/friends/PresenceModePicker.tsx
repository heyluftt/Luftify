import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t, type MessageKey } from "../../i18n";
import type { FriendsControls, PresenceMode, SocialOptions } from "./friendsTypes";

const MODES: { mode: PresenceMode; label: MessageKey; hint: MessageKey; dot: string }[] = [
  { mode: "auto", label: "activity.mode.auto", hint: "activity.mode.autoHint", dot: "online" },
  { mode: "away", label: "activity.away", hint: "activity.mode.awayHint", dot: "away" },
  { mode: "busy", label: "activity.busy", hint: "activity.mode.busyHint", dot: "busy" },
  { mode: "invisible", label: "activity.mode.invisible", hint: "activity.mode.invisibleHint", dot: "offline" },
];

/** Your status for friends: automatic, away, do not disturb or invisible. */
export function PresenceModePicker({ options, controls, disabled }: { options: SocialOptions; controls: FriendsControls; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const mode = options.presenceMode ?? "auto";
  const current = MODES.find((entry) => entry.mode === mode) ?? MODES[0]!;
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return <div className="presence-picker" ref={root}>
    <button type="button" className="presence-picker-button" aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
      onClick={() => setOpen(!open)}>
      <i data-activity={current.dot} aria-hidden="true" />{t(current.label)}<ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <ul className="presence-picker-menu" role="listbox" aria-label={t("activity.mode.label")}>
      {MODES.map((entry) => <li key={entry.mode} role="option" aria-selected={entry.mode === mode}>
        <button type="button" disabled={controls.pending} onClick={() => {
          setOpen(false);
          if (entry.mode !== mode) controls.send({ type: "action", action: { type: "updateOptions", options: { ...options, presenceMode: entry.mode } } });
        }}>
          <i data-activity={entry.dot} aria-hidden="true" />
          <span><strong>{t(entry.label)}</strong><small>{t(entry.hint)}</small></span>
          {entry.mode === mode && <Check size={15} aria-hidden="true" />}
        </button>
      </li>)}
    </ul>}
  </div>;
}
