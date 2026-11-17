import type { QueryClient } from "@tanstack/react-query";
import type { ListenTogetherStatus } from "./listenTogetherTypes";

export const LISTEN_TOGETHER_QUERY_KEY = "listen-together";

export function newerRoomStatus(current: ListenTogetherStatus | undefined, incoming: ListenTogetherStatus) {
  if (current?.roomId && current.roomId === incoming.roomId &&
      (current.revision > incoming.revision || (current.queue?.revision ?? 0) > (incoming.queue?.revision ?? 0))) {
    return current;
  }
  return incoming;
}

export function cacheRoomStatus(client: QueryClient, incoming: ListenTogetherStatus) {
  const queryKey = [LISTEN_TOGETHER_QUERY_KEY];
  const current = client.getQueryData<ListenTogetherStatus>(queryKey);
  const status = newerRoomStatus(current, incoming);
  // A poll started before this event must not restore a removed/moved entry,
  // or bring back the previous room after leaving.
  void client.cancelQueries({ queryKey }, { revert: false });
  client.setQueryData(queryKey, status);
  return status;
}
