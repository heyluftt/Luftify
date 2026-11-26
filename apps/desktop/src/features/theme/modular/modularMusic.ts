import { create } from "zustand";

const KEY = "luft.modular.music";

function stored(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

/** Whether the Modular cable sways to the music. Per device, on by default. */
export const useModularMusic = create<{ enabled: boolean; set: (enabled: boolean) => void }>((set) => ({
  enabled: stored(),
  set: (enabled) => {
    try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch { /* stays for this session */ }
    set({ enabled });
  },
}));
