import { create } from "zustand";
import type { ListenTogetherStatus } from "./listenTogetherTypes";
import { usePlayerStore } from "../../stores/playerStore";

export const useListenRoomState = create<{ status: ListenTogetherStatus | undefined; locked: boolean; skipping: boolean; error: boolean }>(() => ({
  status: undefined, locked: false, skipping: false, error: false,
}));

export function setListenTogetherGuestLock(locked: boolean) {
  useListenRoomState.setState({ locked, ...(!locked ? { status: undefined } : {}) });
}
export function setListenTogetherStatus(status: ListenTogetherStatus) {
  const changedRoom = useListenRoomState.getState().status?.roomId !== status.roomId;
  useListenRoomState.setState({ status, locked: Boolean(status.roomId), ...(changedRoom ? { error: false } : {}) });
  // Room playback starts in Rust, bypassing the local play-click path that
}
export function isListenTogetherGuestLock() { return useListenRoomState.getState().locked; }
