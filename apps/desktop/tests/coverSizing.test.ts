import { describe, expect, it } from "vitest";
import { sizedCoverUrl } from "../src/components/coverSizing";

const ID = "0123456789abcdef01234567";

describe("cover sizing", () => {
  it("picks the smallest sharp album variant for the display size", () => {
    const original = `https://i.scdn.co/image/ab67616d0000b273${ID}`;
    expect(sizedCoverUrl(original, "tiny", 1)).toBe(`https://i.scdn.co/image/ab67616d00004851${ID}`);
    expect(sizedCoverUrl(original, "tiny", 2)).toBe(`https://i.scdn.co/image/ab67616d00001e02${ID}`);
    expect(sizedCoverUrl(original, "medium", 1)).toBe(`https://i.scdn.co/image/ab67616d00001e02${ID}`);
    expect(sizedCoverUrl(original, "feature", 1)).toBe(original);
  });

  it("upgrades small variants for big views and handles artists and mosaics", () => {
    expect(sizedCoverUrl(`https://i.scdn.co/image/ab67616d00004851${ID}`, "feature", 1))
      .toBe(`https://i.scdn.co/image/ab67616d0000b273${ID}`);
    expect(sizedCoverUrl(`https://i.scdn.co/image/ab6761610000e5eb${ID}`, "tiny", 1))
      .toBe(`https://i.scdn.co/image/ab6761610000f178${ID}`);
    expect(sizedCoverUrl("https://mosaic.scdn.co/640/abc", "tiny", 1)).toBe("https://mosaic.scdn.co/60/abc");
  });

  it("leaves unknown URLs untouched", () => {
    const playlist = `https://i.scdn.co/image/ab67706c0000da84${ID}`;
    expect(sizedCoverUrl(playlist, "tiny", 1)).toBe(playlist);
    expect(sizedCoverUrl("https://example.com/a.jpg", "tiny", 1)).toBe("https://example.com/a.jpg");
  });
});
