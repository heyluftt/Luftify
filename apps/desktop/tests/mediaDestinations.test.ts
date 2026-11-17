import { describe, expect, it } from "vitest";
import { albumDestination, contextDestination } from "../src/features/entities/mediaDestinations";

describe("media destinations", () => {
  it("opens a concrete album uri", () => {
    expect(
      albumDestination({
        title: "Airborne",
        albumName: "Glass Cities",
        albumUri: "spotify:album:glass",
      }),
    ).toEqual({
      path: "/album/spotify%3Aalbum%3Aglass",
      label: "Glass Cities",
      summary: {
        uri: "spotify:album:glass",
        name: "Glass Cities",
        subtitle: "Album",
      },
    });
  });

  it("falls back to album search when only a name exists", () => {
    expect(
      albumDestination({
        title: "Airborne",
        albumName: "Glass Cities",
      }),
    ).toEqual({
      path: "/search?q=Glass+Cities&type=albums",
      label: "Glass Cities",
    });
  });

  it("opens the current playlist context", () => {
    expect(contextDestination("spotify:playlist:night")?.path)
      .toBe("/playlist/spotify%3Aplaylist%3Anight");
  });

  it("opens the current artist context", () => {
    expect(contextDestination("spotify:artist:kavinsky")).toEqual({
      path: "/artist/spotify%3Aartist%3Akavinsky",
      label: "Aktuelles Künstlerprofil",
      summary: {
        uri: "spotify:artist:kavinsky",
        name: "Künstler",
        subtitle: "Künstler",
      },
    });
  });
});
