import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { FRIENDS_QUERY_KEY, useFriends } from "./useFriends";
import type { FriendsStatus } from "./friendsTypes";
import { usePlaylistIdentity } from "../playlists/usePlaylistIdentity";

export function FriendsSync() {
  const client = useQueryClient();
  // The only poller; invitations and requests show as notices (NoticeStack).
  const friends = useFriends(true);
  usePlaylistIdentity(friends.data);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<FriendsStatus>("friends://status", event => {
      client.setQueryData(FRIENDS_QUERY_KEY, event.payload);
    }).then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, [client]);
  return null;
}
