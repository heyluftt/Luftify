import { describe, expect, it } from "vitest";
import { themeArtworkRoute } from "../src/features/theme/themeArtworkRoute";

describe("illustrated theme artwork routes", () => {
  it.each([
    ["/", "home"],
    ["/search", "discovery"],
    ["/library", "discovery"],
    ["/liked", "discovery"],
    ["/queue", "radio"],
    ["/insights", "radio"],
    ["/lyrics", "lyrics"],
    ["/lyrics/", "lyrics"],
    ["/modules/lyrics", "lyrics"],
    ["/settings", "solo"],
    ["/modules", "solo"],
  ] as const)("maps %s to %s", (pathname, artwork) => {
    expect(themeArtworkRoute(pathname)).toBe(artwork);
  });

  it.each([
    "/artist/spotify:artist:1",
    "/album/spotify:album:1",
    "/playlist/spotify:playlist:1",
  ])("keeps functional artwork clear on %s", (pathname) => {
    expect(themeArtworkRoute(pathname)).toBe("none");
  });

  it.each(["/search/", "/library/", "/liked/"])(
    "normalizes a trailing slash on discovery route %s",
    (pathname) => {
      expect(themeArtworkRoute(pathname)).toBe("discovery");
    },
  );
});
