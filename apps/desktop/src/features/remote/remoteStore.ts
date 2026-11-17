import { create } from "zustand";
import type { RemoteDevice } from "./remoteTypes";

interface RemoteStore {
  you: string;
  devices: RemoteDevice[];
  set: (you: string, devices: RemoteDevice[]) => void;
}

/** The profile's devices online right now (friends/remote.rs). */
export const useRemoteDevices = create<RemoteStore>((set) => ({
  you: "",
  devices: [],
  set: (you, devices) => set({ you, devices }),
}));

/** Devices other than this PC, e.g. a phone that may steer it. */
export const otherDevices = (state: Pick<RemoteStore, "you" | "devices">) => state.devices.filter((device) => device.id !== state.you);
