import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLyricsArtworkFocus } from "../src/features/lyrics/useLyricsArtworkFocus";

describe("lyrics artwork focus", () => {
  beforeEach(() => window.localStorage.removeItem("luftplayer.lyrics.artwork-focus"));

  it("hides details and remembers the choice locally", () => {
    const { result, unmount } = renderHook(() => useLyricsArtworkFocus());
    expect(result.current.detailsHidden).toBe(false);

    act(() => result.current.toggleDetails());
    expect(result.current.detailsHidden).toBe(true);
    expect(window.localStorage.getItem("luftplayer.lyrics.artwork-focus")).toBe("hidden");

    unmount();
    const restored = renderHook(() => useLyricsArtworkFocus());
    expect(restored.result.current.detailsHidden).toBe(true);
  });
});
