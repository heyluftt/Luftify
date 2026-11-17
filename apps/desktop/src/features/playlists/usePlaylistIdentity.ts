import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi } from "../../services/desktopApi";
import { friendsApi } from "../friends/friendsApi";
import { FRIENDS_QUERY_KEY } from "../friends/useFriends";
import type { FriendsStatus } from "../friends/friendsTypes";
import { playlistAccountKey } from "./playlistIdentity";

/** Bind only the currently authenticated local account. No Spotify name leaves the app. */
export function usePlaylistIdentity(status: FriendsStatus | undefined) {
  const client = useQueryClient();
  const libre = useQuery({ queryKey: ["librespot-status"], queryFn: desktopApi.librespotStatus,
    enabled: status?.connection === "online", staleTime: 15_000 });
  const attempted = useRef("");
  const username = libre.data?.phase === "ready" ? libre.data.username : undefined;
  useEffect(() => {
    const snapshot = status?.snapshot;
    if (status?.connection !== "online" || !snapshot || snapshot.playlistAccounts === undefined || !username) return;
    let active = true;
    const identity = `${status.serverUrl}:${snapshot.me.id}:${username}`;
    void playlistAccountKey(username).then(async key => {
      if (!active || snapshot.playlistAccounts?.some(account => account.profileId === snapshot.me.id && account.accountKey === key) || attempted.current === identity) return;
      attempted.current = identity;
      try {
        const next = await friendsApi.run({ type: "action", action: { type: "bindPlaylistAccount", accountKey: key } });
        if (active) client.setQueryData(FRIENDS_QUERY_KEY, next);
      } catch { if (attempted.current === identity) attempted.current = ""; }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [client, status, username]);
}
