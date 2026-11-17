import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { queryClient } from "../../queryClient";
import { PlaybackSync } from "../playback/PlaybackSync";
import { ThemeSync } from "../theme/ThemeSync";
import { usePrismaPalette } from "../theme/usePrismaPalette";
import { MiniPlayer } from "./MiniPlayer";

export function MiniPlayerApp() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MiniPlayerSettingsEvents />
        <PlaybackSync mode="compact" />
        <ThemeSync />
        <MiniPlayerPrismaSync />
        <MiniPlayer />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function MiniPlayerPrismaSync() {
  usePrismaPalette();
  return null;
}

function MiniPlayerSettingsEvents() {
  const client = useQueryClient();
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("settings://changed", () => {
      void client.invalidateQueries({ queryKey: ["settings"] });
    }).then((dispose) => { if (disposed) dispose(); else unlisten = dispose; });
    return () => { disposed = true; unlisten?.(); };
  }, [client]);
  return null;
}
