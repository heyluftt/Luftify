import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
}));
const setZone = vi.fn(async (_zone: unknown) => undefined);
vi.mock("../src/services/desktopApi", () => ({ desktopApi: { setMiniplayerUnlockZone: (zone: unknown) => setZone(zone) } }));
// jsdom has no ResizeObserver; WebView2 does.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { MiniPlayerLock } from "../src/features/miniplayer/MiniPlayerLock";

describe("mini player lock", () => {
  afterEach(() => {
    cleanup();
    setZone.mockClear();
    handlers.clear();
  });

  it("reports its place, shows the unlock progress and forgets the place when gone", async () => {
    const { unmount } = render(<MiniPlayerLock />);
    expect(setZone).toHaveBeenCalledWith(expect.objectContaining({ scale: expect.any(Number) }));
    expect(screen.getByText("2 s aufs Schloss zeigen zum Entsperren")).toBeInTheDocument();

    await waitFor(() => expect(handlers.has("miniplayer://unlock-progress")).toBe(true));
    act(() => handlers.get("miniplayer://unlock-progress")?.({ payload: 0.5 }));
    expect(screen.getByText("Gleich wieder bedienbar …")).toBeInTheDocument();

    unmount();
    expect(setZone).toHaveBeenLastCalledWith(null);
  });
});
