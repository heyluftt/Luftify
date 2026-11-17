import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { desktopApi } from "../../services/desktopApi";
import { setListenTogetherStatus } from "./guestLock";
import type { ListenTogetherStatus } from "./listenTogetherTypes";

import { cacheRoomStatus, newerRoomStatus, LISTEN_TOGETHER_QUERY_KEY } from "./roomStatusCache";
export { LISTEN_TOGETHER_QUERY_KEY } from "./roomStatusCache";

export function useListenTogether(subscribe = false) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [LISTEN_TOGETHER_QUERY_KEY],
    queryFn: async () => {
      const status = await desktopApi.listenTogetherStatus();
      return newerRoomStatus(client.getQueryData<ListenTogetherStatus>([LISTEN_TOGETHER_QUERY_KEY]), status);
    },
    // Status changes arrive as events; polling only backs them up, and outside
    // a room there is little to back up.
    refetchInterval: ({ state }) => state.data?.roomId ? 4_000 : 30_000,
  });

  useEffect(() => {
    if (query.data) setListenTogetherStatus(query.data);
  }, [query.data]);

  const currentId = query.data?.queue?.current?.id;
  useEffect(() => {
    if (subscribe && currentId) void client.invalidateQueries({ queryKey: ["playback"] });
  }, [client, subscribe, currentId]);

  useEffect(() => {
    if (!subscribe) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ListenTogetherStatus>("listen-together://status", (event) => {
      setListenTogetherStatus(cacheRoomStatus(client, event.payload));
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client, subscribe]);

  const createRoom = useMutation({
    mutationFn: desktopApi.listenTogetherCreateRoom,
    onSuccess: (status) => { setListenTogetherStatus(cacheRoomStatus(client, status)); },
  });
  const joinRoom = useMutation({
    mutationFn: desktopApi.listenTogetherJoinRoom,
    onSuccess: (status) => { setListenTogetherStatus(cacheRoomStatus(client, status)); },
  });
  const leave = useMutation({
    mutationFn: desktopApi.listenTogetherLeave,
    onSuccess: (status) => { setListenTogetherStatus(cacheRoomStatus(client, status)); },
  });

  return { query, createRoom, joinRoom, leave };
}
