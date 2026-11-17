import { create } from "zustand";

const KEY = "luft.abyss.music";

function stored(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

/** Whether the Tiefsee scene follows the music. A per-viewer convenience, on by default. */
export const useAbyssMusic = create<{ enabled: boolean; set: (enabled: boolean) => void }>((set) => ({
  enabled: stored(),
  set: (enabled) => {
    try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch { /* stays for this session */ }
    set({ enabled });
  },
}));
