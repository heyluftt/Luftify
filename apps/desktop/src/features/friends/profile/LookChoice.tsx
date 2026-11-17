import { Check, Lock } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

/** Keyboard arrows follow the visible order, skip locked choices and wrap. */
export function navigateChoices(event: KeyboardEvent<HTMLElement>) {
  if (!(event.target instanceof HTMLButtonElement) || !event.target.matches('[role="radio"]')) return;
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)')];
  const index = choices.indexOf(event.target);
  if (index < 0 || !choices.length) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1
    : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + choices.length) % choices.length;
  choices[next]!.focus();
  choices[next]!.click();
}

/** A named material sample with an explicit selected or locked state. */
export function LookChoice({ selected, disabled, locked, label, hint, onPick, children, selectable = true }: {
  selected: boolean;
  disabled: boolean;
  locked?: boolean;
  label: string;
  hint?: string | undefined;
  onPick: () => void;
  children: ReactNode;
  selectable?: boolean;
}) {
  return <button type="button" className="look-choice" role={selectable ? "radio" : undefined} aria-checked={selectable ? selected : undefined}
    disabled={disabled || locked} data-locked={locked || undefined} title={hint}
    aria-label={hint ? `${label} · ${hint}` : label} onClick={onPick}>
    {children}
    <span className="look-choice-label">{label}</span>
    {(locked || selected) && <span className="look-choice-mark" aria-hidden="true">{locked ? <Lock size={12} /> : <Check size={12} />}</span>}
  </button>;
}
