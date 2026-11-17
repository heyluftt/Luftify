import { describe, expect, it } from "vitest";
import {
  playlistHeroCover,
  playlistHeroOwner,
  playlistHeroSubtitle,
} from "../src/features/entities/playlistHero";

describe("playlist hero", () => {
  it("hides canonical owner ids and keeps human names", () => {
    expect(
      playlistHeroOwner("k3vq8zt2wmd61rx9pfhb4ycn0", "Eigene Playlist"),
    ).toBe("Eigene Playlist");
    expect(playlistHeroOwner("Du", undefined)).toBe("Du");
    expect(playlistHeroOwner("Sam", "Playlist")).toBe("Sam");
    expect(playlistHeroOwner(undefined, "Playlist")).toBeUndefined();
  });

  it("prefers a real cover and falls back to the library or first track", () => {
    expect(
      playlistHeroCover(
        "https://i.scdn.co/image/playlist",
        "https://i.scdn.co/image/library",
        "https://i.scdn.co/image/track",
      ),
    ).toBe("https://i.scdn.co/image/playlist");
    expect(
      playlistHeroCover(undefined, "https://i.scdn.co/image/library", "https://i.scdn.co/image/track"),
    ).toBe("https://i.scdn.co/image/library");
    expect(playlistHeroCover(undefined, undefined, "https://i.scdn.co/image/track")).toBe(
      "https://i.scdn.co/image/track",
    );
    expect(playlistHeroCover("spotify:image:legacy", undefined, undefined)).toBeUndefined();
  });

  it("builds a subtitle without leaking the owner id", () => {
    expect(
      playlistHeroSubtitle(
        playlistHeroOwner("k3vq8zt2wmd61rx9pfhb4ycn0", undefined),
        "12 Titel",
      ),
    ).toBe("12 Titel");
    expect(playlistHeroSubtitle("Du", "12 Titel")).toBe("Du · 12 Titel");
  });
});
