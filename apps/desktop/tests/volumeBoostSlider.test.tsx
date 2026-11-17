import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AUDIO_CONTROL_SETTINGS } from "../src/features/audio-control/audioControl";
import { VolumeBoostSlider } from "../src/features/audio-control/VolumeBoostSlider";

describe("volume boost slider", () => {
  afterEach(cleanup);

  it("uses the configured Audio Control wheel step", () => {
    const preview = vi.fn();
    render(
      <VolumeBoostSlider
        disabled={false}
        settings={{ ...DEFAULT_AUDIO_CONTROL_SETTINGS, stepPercent: 5 }}
        value={150}
        onPreview={preview}
        onCommit={vi.fn()}
      />,
    );

    fireEvent.wheel(screen.getByRole("slider", { name: "Volume Boost" }), { deltaY: -100 });

    expect(preview).toHaveBeenCalledWith(155);
  });

  it("previews while dragging and saves the final percentage once", () => {
    const preview = vi.fn();
    const commit = vi.fn();
    render(
      <VolumeBoostSlider
        disabled={false}
        settings={DEFAULT_AUDIO_CONTROL_SETTINGS}
        value={150}
        onPreview={preview}
        onCommit={commit}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Volume Boost" });
    Object.defineProperty(slider, "setPointerCapture", { value: vi.fn() });

    fireEvent.pointerDown(slider, { pointerId: 2 });
    fireEvent.input(slider, { target: { value: "225" } });
    fireEvent.pointerUp(slider, { pointerId: 2 });

    expect(preview).toHaveBeenCalledWith(225);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(225);
  });
});
