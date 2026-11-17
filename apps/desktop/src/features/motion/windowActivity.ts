import { focusManager } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { queryClient } from "../../queryClient";

/** After this long out of view, data no page shows is let go (refetched when needed). */
const RELEASE_AFTER_MS = 2 * 60_000;

/**
 * Minimised or in the tray, nobody sees the page: decorative animations pause
 * (`data-window-idle`) and the backup polling of queries stops (focusManager).
 * The backend keeps playing, syncing rooms and pushing friend events; queries
 * that must go on in the tray opt in with `refetchIntervalInBackground`.
 * WebView2 is asked to keep its memory low meanwhile (webview_memory.rs),
 * and after a while out of view, cached data no page uses is dropped.
 */
export function trackWindowActivity(): void {
  if (!isTauri()) return;
  const window = getCurrentWindow();
  let checking = false;
  let wasIdle: boolean | null = null;
  let release: ReturnType<typeof setTimeout> | undefined;
  const update = async () => {
    if (checking) return;
    checking = true;
    try {
      const idle = document.visibilityState === "hidden" || await window.isMinimized() || !(await window.isVisible());
      document.documentElement.toggleAttribute("data-window-idle", idle);
      // `undefined` hands focus back to the browser's own visibility tracking.
      focusManager.setFocused(idle ? false : undefined);
      if (idle !== wasIdle) {
        wasIdle = idle;
        void invoke("set_window_idle", { idle }).catch(() => undefined);
        globalThis.clearTimeout(release);
        if (idle) release = globalThis.setTimeout(releaseUnusedData, RELEASE_AFTER_MS);
      }
    } catch {
      // A failing window query must never freeze the page.
    } finally {
      checking = false;
    }
  };
  void window.onResized(() => void update());
  void window.onFocusChanged(() => void update());
  document.addEventListener("visibilitychange", () => void update());
  void update();
}

/** Inactive queries with a limited cache time; the library (kept forever) stays. */
function releaseUnusedData() {
  const cache = queryClient.getQueryCache();
  for (const query of cache.findAll({ type: "inactive" })) {
    if (Number.isFinite(query.gcTime)) cache.remove(query);
  }
}
