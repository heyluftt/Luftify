import { describe, expect, it } from "vitest";
import { warmupOrder } from "../src/features/setup/libraryWarmup";

const entry = (id: string) => ({ uri: `spotify:playlist:${id}`, name: id });

describe("warmupOrder", () => {
  it("prepares the most played playlists first, then the library order, without liked songs", () => {
    const library = [entry("a"), entry("b"), entry("c"), entry("d")];
    const usage = [
      { playlistUri: "spotify:playlist:c", playCount: 9, lastPlayedAt: 1 },
      { playlistUri: "spotify:user:x:collection", playCount: 50, lastPlayedAt: 2 },
      { playlistUri: "spotify:playlist:gone", playCount: 7, lastPlayedAt: 3 },
      { playlistUri: "spotify:playlist:b", playCount: 9, lastPlayedAt: 5 },
    ];
    expect(warmupOrder(library, usage, 3).map((item) => item.name)).toEqual(["b", "c", "a"]);
  });
});
