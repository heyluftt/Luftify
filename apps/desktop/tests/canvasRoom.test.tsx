import type { MediaItem } from "@luft/protocol-types";
import { cleanup, fireEvent, render, renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasRoom } from "../src/features/canvas-room/CanvasRoom";
import { useLyricsViewMode } from "../src/features/lyrics/useLyricsViewMode";

vi.mock("../src/components/AlbumArt", () => ({
  AlbumArt: ({ title }: { title: string }) => <div data-testid="cover">{title}</div>,
}));

const item: MediaItem = {
  uri: "spotify:track:room", source: "spotify", itemType: "track",
  title: "First song", creators: [{ name: "Artist" }], explicit: false, playable: true,
  canvasUrl: "https://example.com/canvas.mp4",
};
const drawImage = vi.fn();
const props = { connected: true, playing: true, songVideosEnabled: true, onContextMenu: vi.fn() };

describe("music room", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    drawImage.mockReset();
    localStorage.clear();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("keeps artwork visible until the only video is ready, then recovers on error", () => {
    const { container } = render(<CanvasRoom {...props} item={item} />);
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(container.querySelector(".canvas-room")).not.toHaveClass("has-video");
    fireEvent.loadedData(container.querySelector("video")!);
    expect(container.querySelector(".canvas-room")).toHaveClass("has-video");
    fireEvent.error(container.querySelector("video")!);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".canvas-room")).not.toHaveClass("has-video");
  });

  it("respects disabled Canvas, missing tracks and music pause", () => {
    const { container, rerender } = render(<CanvasRoom {...props} item={item} songVideosEnabled={false} />);
    expect(container.querySelector("video")).toBeNull();
    rerender(<CanvasRoom {...props} item={undefined} />);
    expect(container.querySelector("h1")).toBeTruthy();
    expect(container.querySelector("video")).toBeNull();
    rerender(<CanvasRoom {...props} item={item} playing={false} />);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("drops the previous loaded frame when the source changes", () => {
    const { container, rerender } = render(<CanvasRoom {...props} item={item} />);
    fireEvent.loadedData(container.querySelector("video")!);
    rerender(<CanvasRoom {...props} item={{ ...item, canvasUrl: "https://example.com/next.mp4" }} />);
    expect(container.querySelector(".canvas-room")).not.toHaveClass("has-video");
    expect(container.querySelectorAll("video")).toHaveLength(1);
  });

  it("projects at most eight times a second and stops while hidden or unmounted", () => {
    const { container, unmount } = render(<CanvasRoom {...props} item={item} />);
    const video = container.querySelector("video")!;
    Object.defineProperties(video, {
      readyState: { value: 2 }, videoWidth: { value: 720 }, videoHeight: { value: 1280 },
      paused: { value: false }, currentTime: { get: () => Date.now() / 1000 },
    });
    fireEvent.loadedData(video);
    act(() => vi.advanceTimersByTime(1000));
    expect(drawImage).toHaveBeenCalledTimes(9); // Initial frame plus eight updates.
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    act(() => vi.advanceTimersByTime(1000));
    expect(drawImage).toHaveBeenCalledTimes(9);
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(drawImage).toHaveBeenCalledTimes(10);
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(drawImage).toHaveBeenCalledTimes(10);
  });

  it("keeps room selected even when a song has no lyrics", () => {
    const { result, rerender } = renderHook(({ available }) => useLyricsViewMode(available), { initialProps: { available: true } });
    act(() => result.current.setMode("room"));
    rerender({ available: false });
    expect(result.current.mode).toBe("room");
    expect(localStorage.getItem("luftplayer.lyrics.view-mode")).toBe("room");
  });
});
