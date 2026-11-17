import { create } from "zustand";
import type { RecapPeriod } from "./recapTypes";

/** The recap playing as a story, if any; opened from home, insights or Ctrl+K. */
export const useRecapStore = create<{
  period: RecapPeriod | undefined;
  open: (period: RecapPeriod) => void;
  close: () => void;
}>((set) => ({
  period: undefined,
  open: (period) => set({ period }),
  close: () => set({ period: undefined }),
}));
