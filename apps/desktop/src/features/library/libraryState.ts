import type { Page } from "@luft/protocol-types";
import { t } from "../../i18n";
import type { LibrespotPhase } from "../../types/tauri";

export type LibraryPhase =
  | "loading-cache"
  | "loading-library"
  | "showing-cache"
  | "refreshing-cache"
  | "offline-cache"
  | "needs-login"
  | "ready"
  | "error";

export interface LibraryViewState<T> {
  phase: LibraryPhase;
  data?: Page<T>;
  cached: boolean;
}

/** Remote library reads need the Libre session; the demo provider is always ready. */
export function libraryRemoteEnabled(options: {
  enabled?: boolean | undefined;
  mockMode?: boolean | undefined;
  localReady: boolean;
}): boolean {
  if (options.enabled === false) return false;
  return options.mockMode === true || options.localReady;
}

export function libraryViewState<T>(options: {
  engineReady: boolean;
  localPhase?: LibrespotPhase | undefined;
  cached: Page<T> | null | undefined;
  remote: Page<T> | undefined;
  remoteLoading: boolean;
  remoteFetching: boolean;
  remoteError: boolean;
}): LibraryViewState<T> {
  if (options.remote) return { phase: "ready", data: options.remote, cached: false };
  if (options.engineReady) {
    if (options.cached) {
      return {
        phase: options.remoteFetching ? "refreshing-cache" : "showing-cache",
        data: options.cached,
        cached: true,
      };
    }
    if (options.remoteError && !options.remoteFetching) return { phase: "error", cached: false };
    return { phase: "loading-library", cached: false };
  }
  if (options.cached) {
    const offline = options.localPhase === "disconnected" || options.localPhase === "error";
    return { phase: offline ? "offline-cache" : "showing-cache", data: options.cached, cached: true };
  }
  if (options.localPhase === "needsLogin" || options.localPhase === "error") {
    return { phase: "needs-login", cached: false };
  }
  if (options.localPhase === undefined) return { phase: "loading-cache", cached: false };
  return { phase: "loading-library", cached: false };
}

export function libraryPhaseLabel(phase: LibraryPhase): string {
  switch (phase) {
    case "loading-cache": return t("library.loading");
    case "loading-library": return t("library.loading");
    case "showing-cache": return t("library.cached");
    case "refreshing-cache": return t("library.refreshing");
    case "offline-cache": return t("library.offline");
    case "needs-login": return t("library.needsLogin");
    case "ready": return t("library.ready");
    case "error": return t("library.error");
  }
}
