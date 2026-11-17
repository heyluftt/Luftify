import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { loadRecentlyPlayed, RECENTLY_PLAYED_QUERY_KEY as queryKey } from "./recentApi";

export function useRecentlyPlayed() {
  const client = useQueryClient();
  const query = useQuery({ queryKey, queryFn: loadRecentlyPlayed, staleTime: 0, retry: 1 });
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const refresh = () => { void client.invalidateQueries({ queryKey }); };
    void listen("analytics://changed", refresh).then((stop) => {
      if (disposed) stop();
      else { unlisten = stop; refresh(); }
    }).catch(() => { /* Reopening the panel still reloads if desktop events are unavailable. */ });
    return () => { disposed = true; unlisten?.(); };
  }, [client]);
  return query;
}
