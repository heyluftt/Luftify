import { desktopApi } from "../../services/desktopApi";
import { useListenRoomState } from "./guestLock";
import type { ListenTogetherStatus, RoomControlAction } from "./listenTogetherTypes";

/** What the player controls may do while you are in a room. */
export type RoomTransport = {
  inRoom: boolean;
  isHost: boolean;
  /** Play, pause, seek (the host, or everyone once the host allows it). */
  canControl: boolean;
  /** Skip the playing song: steering, or dropping your own song. */
  canSkip: boolean;
};

export function roomTransport(status: ListenTogetherStatus | undefined, skipping = false): RoomTransport {
  const inRoom = Boolean(status?.roomId);
  const isHost = status?.role === "host";
  const online = status?.connection === "online";
  const current = status?.queue?.current;
  const canControl = inRoom && online && Boolean(current) && (isHost || status?.canControl === true);
  const own = Boolean(current && status?.youId && current.addedById === status.youId);
  return {
    inRoom,
    isHost,
    canControl,
    canSkip: inRoom && online && Boolean(status?.hostConnected) && Boolean(current) && !skipping && (canControl || own),
  };
}

export function useRoomTransport(): RoomTransport {
  const status = useListenRoomState((state) => state.status);
  const skipping = useListenRoomState((state) => state.skipping);
  return roomTransport(status, skipping);
}

export function currentRoomTransport(): RoomTransport {
  const { status, skipping } = useListenRoomState.getState();
  return roomTransport(status, skipping);
}

/** Play, pause or seek the room. The host's own player answers in Rust. */
export async function controlRoom(action: RoomControlAction): Promise<void> {
  if (!currentRoomTransport().canControl) return;
  try {
    await desktopApi.listenTogetherControl(action);
  } catch {
    useListenRoomState.setState({ error: true });
  }
}

export async function skipRoomTrack(): Promise<void> {
  const { status, skipping } = useListenRoomState.getState();
  const current = status?.queue?.current;
  if (!roomTransport(status, skipping).canSkip || !status?.roomId || !current) return;
  useListenRoomState.setState({ skipping: true, error: false });
  try {
    // Capture the occurrence before sending; rapid clicks must never skip the
    // successor just because the first command advanced the shared queue.
    await desktopApi.listenTogetherQueueEdit(status.roomId, { type: "remove", id: current.id });
  } catch {
    if (useListenRoomState.getState().status?.roomId === status.roomId) useListenRoomState.setState({ error: true });
  } finally { useListenRoomState.setState({ skipping: false }); }
}
