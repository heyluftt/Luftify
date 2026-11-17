import type { EntitySummary, Page } from "@luft/protocol-types";
import { describe, expect, it } from "vitest";
import { libraryRemoteEnabled, libraryViewState } from "../src/features/library/libraryState";

const page = (name: string): Page<EntitySummary> => ({ items: [{ uri: `spotify:playlist:${name}`, name }], offset: 0, limit: 50, total: 1, hasMore: false });
const idle = { cached: undefined, remote: undefined, remoteLoading: false, remoteFetching: false, remoteError: false } as const;

describe("library state", () => {
  it("reads the remote library only once Libre is connected or the demo provider runs", () => {
    expect(libraryRemoteEnabled({ localReady: false })).toBe(false);
    expect(libraryRemoteEnabled({ localReady: true })).toBe(true);
    expect(libraryRemoteEnabled({ mockMode: true, localReady: false })).toBe(true);
    expect(libraryRemoteEnabled({ enabled: false, mockMode: true, localReady: true })).toBe(false);
  });

  it("shows valid cache while the remote response is still loading", () => {
    const state = libraryViewState({ ...idle, engineReady: true, localPhase: "ready", cached: page("cached"), remoteLoading: true, remoteFetching: true });
    expect(state.phase).toBe("refreshing-cache");
    expect(state.cached).toBe(true);
    expect(state.data?.items[0]?.name).toBe("cached");
  });

  it("shows cache without a refresh marker when nothing is fetching", () => {
    const state = libraryViewState({ ...idle, engineReady: true, localPhase: "ready", cached: page("cached") });
    expect(state.phase).toBe("showing-cache");
  });

  it("replaces cached data with the confirmed background refresh", () => {
    const state = libraryViewState({ ...idle, engineReady: true, localPhase: "ready", cached: page("cached"), remote: page("fresh") });
    expect(state.phase).toBe("ready");
    expect(state.cached).toBe(false);
    expect(state.data?.items[0]?.name).toBe("fresh");
  });

  it("uses offline cache while Libre is disconnected or failed", () => {
    for (const localPhase of ["disconnected", "error"] as const) {
      const state = libraryViewState({ ...idle, engineReady: false, localPhase, cached: page("cached") });
      expect(state.phase).toBe("offline-cache");
      expect(state.data?.items[0]?.name).toBe("cached");
    }
  });

  it("keeps the cache visible while Libre still connects", () => {
    const state = libraryViewState({ ...idle, engineReady: false, localPhase: "connecting", cached: page("cached") });
    expect(state.phase).toBe("showing-cache");
  });

  it("loads the library once Libre is ready", () => {
    const state = libraryViewState({ ...idle, engineReady: true, localPhase: "ready", remoteLoading: true, remoteFetching: true });
    expect(state.phase).toBe("loading-library");
  });

  it("keeps loading while a failed playlist refresh is retried", () => {
    const state = libraryViewState({ ...idle, engineReady: true, localPhase: "ready", remoteFetching: true, remoteError: true });
    expect(state.phase).toBe("loading-library");
  });

  it("reports an error only after the failed refresh settled", () => {
    const state = libraryViewState({ ...idle, engineReady: true, localPhase: "ready", remoteError: true });
    expect(state.phase).toBe("error");
  });

  it("asks for login instead of a failed refresh before Libre is ready", () => {
    expect(libraryViewState({ ...idle, engineReady: false, localPhase: "needsLogin", remoteError: true }).phase).toBe("needs-login");
    expect(libraryViewState({ ...idle, engineReady: false, localPhase: "error", remoteError: true }).phase).toBe("needs-login");
  });

  it("waits for the cache while the Libre phase is unknown and loads while it connects", () => {
    expect(libraryViewState({ ...idle, engineReady: false }).phase).toBe("loading-cache");
    expect(libraryViewState({ ...idle, engineReady: false, localPhase: "connecting" }).phase).toBe("loading-library");
  });
});
