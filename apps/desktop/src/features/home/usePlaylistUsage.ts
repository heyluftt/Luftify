import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { desktopApi } from "../../services/desktopApi";

export function usePlaylistUsage(enabled = true) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["playlist-usage"],
    queryFn: desktopApi.playlistUsage,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    enabled,
  });
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen("home://playlist-usage-changed", () => {
      void client.invalidateQueries({ queryKey: ["playlist-usage"] });
    }).then((listener) => {
      if (disposed) listener();
      else unlisten = listener;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client, enabled]);
  return query;
}
