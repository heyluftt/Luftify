import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { desktopApi } from "../../services/desktopApi";
import { MINIPLAYER_LABEL } from "./miniplayerSettings";

export function isMiniPlayerWindow(): boolean {
  try {
    return typeof window !== "undefined"
      && "__TAURI_INTERNALS__" in window
      && getCurrentWindow().label === MINIPLAYER_LABEL;
  } catch {
    return false;
  }
}

export function startMiniPlayerDrag(): Promise<void> {
  return getCurrentWindow().startDragging();
}

export function usePersistMiniPlayerPosition(): void {
  useEffect(() => {
    let timer: number | undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onMoved(({ payload }) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!disposed) void desktopApi.saveMiniplayerPosition(payload.x, payload.y);
      }, 320);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, []);
}
