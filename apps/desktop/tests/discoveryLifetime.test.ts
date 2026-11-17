import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { discoveryQuery } from "../src/features/discovery/discoveryQuery";
import { generateDiscovery } from "../src/features/discovery/discoveryService";
import { useMixLibrary } from "../src/features/discovery/mixLibrary";

vi.mock("../src/features/discovery/discoveryService", () => ({ generateDiscovery: vi.fn() }));
vi.mock("../src/features/discovery/mixLibrary", () => {
  const state = { ready: true, mixes: [], add: vi.fn() };
  return { initializeMixLibrary: vi.fn().mockResolvedValue(undefined), recentMixTrackUris: () => new Set<string>(), useMixLibrary: { getState: () => state } };
});

it("continues on route unmount but still supports explicit global cancellation", async () => {
  const client = new QueryClient();
  const options = { ...discoveryQuery(client), enabled: false };
  const global = new QueryObserver(client, options);
  const home = new QueryObserver(client, options);
  const stopGlobal = global.subscribe(() => {});
  const stopHome = home.subscribe(() => {});
  let signal!: AbortSignal;
  let finish!: (value: Awaited<ReturnType<typeof generateDiscovery>>) => void;
  vi.mocked(generateDiscovery).mockImplementation((received) => {
    signal = received;
    return new Promise((resolve) => { finish = resolve; });
  });
  try {
    const running = home.refetch();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    stopHome();
    expect(signal.aborted).toBe(false);
    finish({ picks: [], incomplete: false, noProfile: false });
    await running;
    expect(useMixLibrary.getState().add).toHaveBeenCalledTimes(1);
    const previousSignal = signal;
    const again = global.refetch();
    await vi.waitFor(() => expect(signal).not.toBe(previousSignal));
    await client.cancelQueries({ queryKey: ["discovery-mix"] });
    expect(signal.aborted).toBe(true);
    finish({ picks: [], incomplete: false, noProfile: false });
    await again;
    expect(useMixLibrary.getState().add).toHaveBeenCalledTimes(1);
  } finally {
    stopHome(); stopGlobal(); client.clear();
  }
});
