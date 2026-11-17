import { create } from "zustand";

/** "system" follows Windows (reduced motion → off, otherwise full). */
export type MotionChoice = "system" | "full" | "subtle" | "off";
export type MotionLevel = Exclude<MotionChoice, "system">;

const KEY = "luft.motion";
const CHOICES: readonly MotionChoice[] = ["system", "full", "subtle", "off"];

function stored(): MotionChoice {
  try {
    const value = localStorage.getItem(KEY) as MotionChoice | null;
    return value && CHOICES.includes(value) ? value : "system";
  } catch {
    return "system";
  }
}

function systemReduces(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** The root carries the choice; styles/motion/levels.css reads it. */
function apply(choice: MotionChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.motion;
  else root.dataset.motion = choice;
}

/** How much the app moves. A per-device convenience, stored locally. */
export const useMotionChoice = create<{ choice: MotionChoice; set: (choice: MotionChoice) => void }>((set) => ({
  choice: stored(),
  set: (choice) => {
    try { localStorage.setItem(KEY, choice); } catch { /* stays for this session */ }
    apply(choice);
    set({ choice });
  },
}));

apply(useMotionChoice.getState().choice);

export function resolveMotion(choice: MotionChoice): MotionLevel {
  if (choice !== "system") return choice;
  return systemReduces() ? "off" : "full";
}

/** The level in effect right now, for code outside React. */
export function motionLevel(): MotionLevel {
  return resolveMotion(useMotionChoice.getState().choice);
}

/** True when animations should stay still (setting "off", or Windows asks for it). */
export function prefersLessMotion(): boolean {
  return motionLevel() === "off";
}

/** React variant of {@link prefersLessMotion}; re-renders when the setting changes. */
export function useLessMotion(): boolean {
  return resolveMotion(useMotionChoice((state) => state.choice)) === "off";
}
