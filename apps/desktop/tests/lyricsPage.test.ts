import { describe, expect, it } from "vitest";
import {
  activeLyricIndex,
  isLyricsInterlude,
  lyricLineClassName,
} from "../src/features/lyrics/lyricsTimeline";

describe("activeLyricIndex", () => {
  const lines = [
    { startMs: 1_000, text: "One" },
    { startMs: 2_500, text: "Two" },
    { startMs: 4_000, text: "Three" },
  ];

  it("selects the latest reached synchronized line", () => {
    expect(activeLyricIndex(lines, 0)).toBe(-1);
    expect(activeLyricIndex(lines, 2_600)).toBe(1);
  });

  it("does not advance far ahead of playback", () => {
    expect(activeLyricIndex(lines, 3_800)).toBe(1);
  });
});

describe("lyrics line presentation", () => {
  it("makes the first upcoming lines readable before the vocal starts", () => {
    expect(lyricLineClassName(0, -1)).toBe("future near upcoming");
    expect(lyricLineClassName(1, -1)).toBe("future mid");
    expect(lyricLineClassName(2, -1)).toBe("future far");
  });

  it("recognizes standalone musical interludes", () => {
    expect(isLyricsInterlude("♪")).toBe(true);
    expect(isLyricsInterlude("♫  ♪")).toBe(true);
    expect(isLyricsInterlude("♪ still singing")).toBe(false);
  });
});
