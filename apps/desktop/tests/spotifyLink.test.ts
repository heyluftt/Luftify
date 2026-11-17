import { describe, expect, it } from "vitest";
import { parseSpotifyLink } from "../src/features/links/spotifyLink";

const ID = "4uLU6hMCjMI75M1A2tKUQC";

describe("parseSpotifyLink", () => {
  it("reads shared web links with language prefix and tracking", () => {
    expect(parseSpotifyLink(`https://open.spotify.com/intl-de/track/${ID}?si=abc123`)).toEqual({ kind: "track", uri: `spotify:track:${ID}` });
    expect(parseSpotifyLink(`open.spotify.com/album/${ID}`)).toEqual({ kind: "album", uri: `spotify:album:${ID}` });
    expect(parseSpotifyLink(`https://open.spotify.com/user/someone/playlist/${ID}`)).toEqual({ kind: "playlist", uri: `spotify:playlist:${ID}` });
    expect(parseSpotifyLink(`https://open.spotify.com/embed/artist/${ID}`)).toEqual({ kind: "artist", uri: `spotify:artist:${ID}` });
  });

  it("finds the link inside a message and reads spotify: URIs", () => {
    expect(parseSpotifyLink(`Hör mal: https://open.spotify.com/track/${ID} 🔥`)?.uri).toBe(`spotify:track:${ID}`);
    expect(parseSpotifyLink(`spotify:user:x:playlist:${ID}`)?.uri).toBe(`spotify:playlist:${ID}`);
  });

  it("ignores everything else", () => {
    expect(parseSpotifyLink("")).toBeUndefined();
    expect(parseSpotifyLink("nachtbus paula")).toBeUndefined();
    expect(parseSpotifyLink(`https://open.spotify.com/show/${ID}`)).toBeUndefined();
    expect(parseSpotifyLink("https://open.spotify.com/track/short")).toBeUndefined();
  });
});
