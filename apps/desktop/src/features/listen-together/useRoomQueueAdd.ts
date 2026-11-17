import { useMutation } from "@tanstack/react-query";
import type { MediaItem } from "@luft/protocol-types";
import { t } from "../../i18n";
import { useListenRoomState } from "./guestLock";
import { ROOM_QUEUE_LIMIT, addTracksToRoom, collectionTracks, type RoomAddResult } from "./roomQueueBatch";

/** `name` makes the songs one block in the queue, named after the collection. */
export type RoomAddSource = ({ uri: string } | { tracks: MediaItem[] }) & { name?: string };

/** Adds songs, a playlist or an album to the room's shared queue. */
export function useRoomQueueAdd() {
  const inRoom = useListenRoomState((state) => Boolean(state.status?.roomId) && state.status?.connection === "online");
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ source, next }: { source: RoomAddSource; next: boolean }) => {
      const status = useListenRoomState.getState().status;
      if (!status?.roomId) throw new Error("listen.queueUnavailable");
      const free = ROOM_QUEUE_LIMIT - (status.queue?.items.length ?? 0);
      if (free <= 0) throw new Error("listen.queueFull");
      const items = "tracks" in source ? source.tracks : await collectionTracks(source.uri, free);
      // Read again: loading a large playlist can take a moment.
      const group = source.name && items.length > 1 ? { id: crypto.randomUUID(), name: source.name.slice(0, 100) } : undefined;
      return addTracksToRoom(useListenRoomState.getState().status ?? status, items, next, group);
    },
  });
  return { inRoom, mutation };
}

export function roomAddFeedback(mutation: { isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown; data?: RoomAddResult | undefined }): string | null {
  if (mutation.isPending) return t("listen.room.adding");
  if (mutation.isError) {
    const message = mutation.error instanceof Error ? mutation.error.message : typeof mutation.error === "string" ? mutation.error : "";
    if (message === "listen.queueFull") return t("listen.queueFull");
    if (message === "listen.queueNothingPlayable") return t("listen.queueNothingPlayable");
    if (message === "listen.queueUncertain") return t("listen.queueUncertain");
    return t("listen.queueConflict");
  }
  if (mutation.isSuccess && mutation.data) {
    const { added, skipped } = mutation.data;
    if (skipped) return t("listen.room.addedPartial", { n: added, skipped });
    return t(added === 1 ? "listen.room.addedOne" : "listen.room.added", { n: added });
  }
  return null;
}
