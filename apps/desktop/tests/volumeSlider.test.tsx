import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VolumeSlider } from "../src/features/audio-control/VolumeSlider";
import { DEFAULT_AUDIO_CONTROL_SETTINGS } from "../src/features/audio-control/audioControl";
import { volumeCoordinator } from "../src/features/playback/VolumeCommandCoordinator";

const playbackMock = vi.hoisted(() => ({ playback: { volume: 0.5, isMuted: false } }));

vi.mock("../src/features/playback/usePlayback", () => ({
  usePlayback: () => ({
    playback: playbackMock.playback,
    connected: true,
  }),
}));

describe("Audio Control volume slider", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    playbackMock.playback = { volume: 0.5, isMuted: false };
  });

  it("uses the configured wheel step only over the slider", () => {
    const set = vi
      .spyOn(volumeCoordinator, "setMapped")
      .mockImplementation(() => undefined);

    render(
      <VolumeSlider
        settings={{
          ...DEFAULT_AUDIO_CONTROL_SETTINGS,
          stepPercent: 5,
        }}
      />,
    );

    fireEvent.wheel(
      screen.getByRole("slider", { name: "Lautstärke" }),
      { deltaY: -100 },
    );

    expect(set).toHaveBeenCalledWith({ uiValue: 0.55, spotifyValue: 0.55, curve: "linear" }, expect.any(Number));
  });

  it("does not intercept wheel input when the module extension is disabled", () => {
    const set = vi
      .spyOn(volumeCoordinator, "setMapped")
      .mockImplementation(() => undefined);

    render(
      <VolumeSlider
        settings={{
          ...DEFAULT_AUDIO_CONTROL_SETTINGS,
          enabled: false,
          wheelEnabled: false,
        }}
      />,
    );

    fireEvent.wheel(
      screen.getByRole("slider", { name: "Lautstärke" }),
      { deltaY: -100 },
    );

    expect(set).not.toHaveBeenCalled();
  });

  it("ends drag on pointer cancel and commits the last visible value", () => {
    const begin = vi.spyOn(volumeCoordinator, "beginDrag").mockImplementation(() => undefined);
    const cancel = vi.spyOn(volumeCoordinator, "cancelDrag").mockImplementation(() => undefined);
    render(<VolumeSlider settings={DEFAULT_AUDIO_CONTROL_SETTINGS} />);
    const slider = screen.getByRole("slider", { name: "Lautstärke" });
    Object.defineProperty(slider, "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(slider, { pointerId: 3 });
    fireEvent.pointerCancel(slider, { pointerId: 3 });
    expect(begin).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("shows zero while Spotify is muted and unmutes from the visible value", () => {
    playbackMock.playback = { volume: 0.5, isMuted: true };
    const set = vi.spyOn(volumeCoordinator, "setMapped").mockImplementation(() => undefined);
    render(<VolumeSlider settings={DEFAULT_AUDIO_CONTROL_SETTINGS} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.value).toBe("0");
    fireEvent.wheel(slider, { deltaY: -100 });
    expect(set).toHaveBeenCalledWith({ uiValue: 0.05, spotifyValue: 0.05, curve: "linear" }, expect.any(Number));
  });
});
