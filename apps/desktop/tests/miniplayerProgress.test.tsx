import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MiniPlayerProgress } from "../src/features/miniplayer/MiniPlayerProgress";

const state = vi.hoisted(() => ({
  playback: {
    currentItem: { uri: "spotify:track:test", durationMs: 180_000 },
    positionMs: 20_000, durationMs: 180_000, isPlaying: true,
    clockReady: true, repeatMode: "off", shuffleEnabled: false,
  },
  connected: true,
  seek: { status: { phase: "idle" }, begin: vi.fn(), preview: vi.fn(), commit: vi.fn() },
}));
vi.mock("../src/features/playback/usePlayback", () => ({ usePlayback: () => state }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  state.playback.repeatMode = "off";
  state.playback.shuffleEnabled = false;
});

it("keeps elapsed progress while settings hide and reveal the seekbar", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });
  const view = render(<MiniPlayerProgress />);
  act(() => vi.advanceTimersByTime(2_000));
  view.rerender(<MiniPlayerProgress hidden />);
  act(() => vi.advanceTimersByTime(2_000));
  view.rerender(<MiniPlayerProgress />);
  expect(Number(view.getByRole("slider").getAttribute("value"))).toBe(24_000);
});

it("does not rewind elapsed progress for repeat or shuffle changes", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });
  const view = render(<MiniPlayerProgress />);
  act(() => vi.advanceTimersByTime(2_000));
  state.playback.repeatMode = "one";
  view.rerender(<MiniPlayerProgress />);
  expect(Number(view.getByRole("slider").getAttribute("value"))).toBe(22_000);
  state.playback.shuffleEnabled = true;
  view.rerender(<MiniPlayerProgress />);
  expect(Number(view.getByRole("slider").getAttribute("value"))).toBe(22_000);
  act(() => vi.advanceTimersByTime(1_000));
  expect(Number(view.getByRole("slider").getAttribute("value"))).toBe(23_000);
});
