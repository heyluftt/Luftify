import type { MediaItem } from "@luft/protocol-types";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LyricsCoverView } from "../src/features/lyrics/LyricsCoverView";
import { SongVideo, useSongVideoUrl } from "../src/features/lyrics/SongVideo";
import { DEFAULT_LYRICS_VISUAL_SETTINGS } from "../src/features/lyrics/lyricsVisualSettings";

vi.mock("../src/components/AlbumArt", () => ({
  AlbumArt: ({ title }: { title: string }) => <div data-testid="cover">{title}</div>,
}));

const item: MediaItem = {
  uri: "spotify:track:canvas",
  source: "spotify",
  itemType: "track",
  title: "Canvas Song",
  creators: [{ name: "Artist" }],
  coverUri: "https://i.scdn.co/image/example",
  canvasUrl: "https://canvaz.scdn.co/upload/example/video.mp4",
  explicit: false,
  playable: true,
};

describe("lyrics cover song videos", () => {
  it("retries a failed Canvas after visiting another track, but not on metadata updates", () => {
    const { result, rerender } = renderHook(
      ({ track }: { track: MediaItem | undefined }) => useSongVideoUrl(track, true),
      { initialProps: { track: item as MediaItem | undefined } },
    );
    act(() => result.current.markUnavailable());
    expect(result.current.url).toBeUndefined();
    rerender({ track: { ...item, title: "Updated metadata" } });
    expect(result.current.url).toBeUndefined();
    // Even another track sharing the URL must not inherit the failed state.
    rerender({ track: { ...item, uri: "spotify:track:other" } });
    expect(result.current.url).toBe(item.canvasUrl);
    rerender({ track: item });
    expect(result.current.url).toBe(item.canvasUrl);
    act(() => result.current.markUnavailable());
    rerender({ track: undefined });
    rerender({ track: item });
    expect(result.current.url).toBe(item.canvasUrl);
  });

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders an enabled Spotify Canvas as a muted loop", () => {
    const { container } = renderCover(true);
    const video = container.querySelector("video");

    expect(video).not.toBeNull();
    expect(video).toHaveProperty("muted", true);
    expect(video).toHaveProperty("loop", true);
    expect(container.querySelector(".lyrics-cover-artwork")).toHaveClass("has-song-video");
  });

  it("does not load a Canvas while the option is disabled", () => {
    const { container } = renderCover(false);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".lyrics-cover-artwork")).not.toHaveClass("has-song-video");
  });

  it("suspends hidden Canvas playback and resumes only while music is playing", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const unavailable = vi.fn();
    const { rerender, unmount } = render(<SongVideo url={item.canvasUrl!} playing onUnavailable={unavailable} />);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    visibility.mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);

    rerender(<SongVideo url={item.canvasUrl!} playing={false} onUnavailable={unavailable} />);
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    unmount();
    fireEvent(document, new Event("visibilitychange"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(unavailable).not.toHaveBeenCalled();
  });

  it("falls back to the cover when the video cannot be loaded", () => {
    const { container, getAllByTestId } = renderCover(true);
    fireEvent.error(container.querySelector("video")!);

    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".lyrics-cover-artwork")).not.toHaveClass("has-song-video");
    expect(getAllByTestId("cover").length).toBeGreaterThan(0);
  });
});

function renderCover(songVideosEnabled: boolean) {
  return render(
    <LyricsCoverView
      connected
      item={item}
      onContextMenu={() => undefined}
      playing
      songVideosEnabled={songVideosEnabled}
      visualSettings={DEFAULT_LYRICS_VISUAL_SETTINGS}
    />,
  );
}
