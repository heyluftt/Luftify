import { create } from "zustand";

const KEY = "luft.pixelpop.music";

function stored(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

/** Whether the Pixelpop skyline bounces to the music. Per device, on by default. */
export const usePixelpopMusic = create<{ enabled: boolean; set: (enabled: boolean) => void }>((set) => ({
  enabled: stored(),
  set: (enabled) => {
    try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch { /* stays for this session */ }
    set({ enabled });
  },
}));
