import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { desktopApi } from "../src/services/desktopApi";
import { DEFAULT_MINIPLAYER_SETTINGS } from "../src/features/miniplayer/miniplayerSettings";
import { useMiniPlayerSettings } from "../src/features/miniplayer/useMiniPlayerSettings";

vi.mock("../src/services/desktopApi", () => ({
  desktopApi: { settings: vi.fn(), saveMiniplayerSettings: vi.fn() },
}));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

it("saves click-through despite continuous playback renders and preserves newer edits", async () => {
  vi.useFakeTimers();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["settings"], { miniplayer: DEFAULT_MINIPLAYER_SETTINGS });
  let finish!: (value: typeof DEFAULT_MINIPLAYER_SETTINGS) => void;
  vi.mocked(desktopApi.saveMiniplayerSettings)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockImplementation(async (value) => value);
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, rerender } = renderHook(useMiniPlayerSettings, { wrapper });
  act(() => result.current.update({ clickThrough: true }));
  for (let frame = 0; frame < 12; frame++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    rerender();
  }
  expect(desktopApi.saveMiniplayerSettings).toHaveBeenCalledTimes(1);
  expect(vi.mocked(desktopApi.saveMiniplayerSettings).mock.lastCall?.[0]).toMatchObject({ clickThrough: true });
  act(() => result.current.update({ opacityPercent: 60 }));
  await act(async () => {
    // A settings refresh must not overwrite the edit made during the pending save.
    client.setQueryData(["settings"], { miniplayer: { ...DEFAULT_MINIPLAYER_SETTINGS, positionX: 100 } });
    finish({ ...DEFAULT_MINIPLAYER_SETTINGS, clickThrough: true });
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(result.current.settings.opacityPercent).toBe(60);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(vi.mocked(desktopApi.saveMiniplayerSettings).mock.lastCall?.[0]).toMatchObject({ clickThrough: true, opacityPercent: 60 });
  client.clear();
});
