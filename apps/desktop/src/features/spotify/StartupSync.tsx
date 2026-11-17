import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { desktopApi } from "../../services/desktopApi";
import type { ConnectionInfo, LibrespotStatus, StartupEvent } from "../../types/tauri";
import { LIBRESPOT_STATUS_QUERY_KEY } from "../playback/usePlaybackEngine";
import { APP_CONNECTION_QUERY_KEY } from "./useAppConnection";

export function StartupSync() {
  const client = useQueryClient();
  useQuery({
    queryKey: ["startup-status"],
    queryFn: desktopApi.startupStatus,
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    let disposed = false;
    let startupUnlisten: UnlistenFn | undefined;
    let librespotUnlisten: UnlistenFn | undefined;
    // Pushed on every change, so "ready" reaches library, home and search at
    // once instead of with the next poll up to 2 s later.
    void listen<LibrespotStatus>("librespot://status", ({ payload }) => {
      client.setQueryData(LIBRESPOT_STATUS_QUERY_KEY, payload);
    }).then((listener) => {
      if (disposed) listener(); else librespotUnlisten = listener;
    });
    void listen<StartupEvent>("startup://phase", ({ payload }) => {
      client.setQueryData(["startup-status"], payload);
      client.setQueryData<ConnectionInfo>(APP_CONNECTION_QUERY_KEY, (current) => current
        ? { ...current, startup: payload }
        : current);
      if (import.meta.env.DEV && import.meta.env.MODE !== "test") {
        console.info("[Luft Startup]", {
          phase: payload.phase,
          durationMs: payload.elapsedMs,
          status: payload.phase === "ready" ? "ready" : payload.phase === "degraded" ? "degraded" : "active",
          adapter: "startup-coordinator",
        });
      }
    }).then((listener) => {
      if (disposed) listener(); else startupUnlisten = listener;
    });
    return () => {
      disposed = true;
      startupUnlisten?.();
      librespotUnlisten?.();
    };
  }, [client]);
  return null;
}
