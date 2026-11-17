import { useListenRoomState } from "./guestLock";
import type { ListenTogetherStatus } from "./listenTogetherTypes";

export type RoomSelectionIntent = "none" | "now" | "queue" | "offline";
export function roomSelectionIntent(status: ListenTogetherStatus | undefined): RoomSelectionIntent {
  if (!status?.roomId) return "none";
  if (status.connection !== "online") return "offline";
  if (status.role === "host" || status.canControl === true) return status.hostConnected ? "now" : "offline";
  return "queue";
}

// A primitive selector keeps ping/drift updates from repainting song lists.
export function useRoomSelectionIntent(): RoomSelectionIntent {
  return useListenRoomState(state => roomSelectionIntent(state.status));
}
