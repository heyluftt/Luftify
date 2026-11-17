import type { MediaItem } from "@luft/protocol-types";
import { describe, expect, it } from "vitest";
import {
  collectPrefetchTargets,
  collectSnapshotCoverUrls,
  coverQueryKey,
  httpsCoverUrl,
  PREFETCH_QUEUE_COVER_LIMIT,
} from "../src/features/prefetch/prefetchTargets";

const track = (change: Partial<MediaItem> = {}): MediaItem => ({
  uri: "spotify:track:now",
  source: "spotify",
  itemType: "track",
  title: "Nightcall",
  creators: [{ name: "Kavinsky", uri: "spotify:artist:kavinsky" }],
  albumName: "OutRun",
  albumUri: "spotify:album:outrun",
  durationMs: 255_000,
  coverUri: "https://i.scdn.co/image/now",
  explicit: false,
  playable: true,
  ...change,
});

describe("media prefetch targets", () => {
  it("prefetches lyrics, cover, album and artist for the current track", () => {
    const targets = collectPrefetchTargets({
      current: track(),
      durationMs: 255_000,
    });

    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "lyrics",
          request: expect.objectContaining({ trackUri: "spotify:track:now" }),
        }),
        { kind: "cover", url: "https://i.scdn.co/image/now", sizes: ["small", "feature"] },
        { kind: "album", uri: "spotify:album:outrun" },
        { kind: "artist", uri: "spotify:artist:kavinsky" },
      ]),
    );
  });

  it("also warms the next queue item and the playing playlist", () => {
    const targets = collectPrefetchTargets({
      current: track(),
      upcoming: [
        track({
          uri: "spotify:track:next",
          title: "Pacific",
          coverUri: "https://i.scdn.co/image/next",
          albumUri: "spotify:album:outrun",
        }),
        track({
          uri: "spotify:track:later",
          title: "Nightcall",
          coverUri: "https://i.scdn.co/image/later",
        }),
      ],
      contextUri: "spotify:playlist:drive",
    });

    expect(targets.filter((target) => target.kind === "lyrics")).toHaveLength(2);
    expect(targets).toContainEqual({
      kind: "cover",
      url: "https://i.scdn.co/image/next",
      sizes: ["small", "feature"],
    });
    expect(targets).toContainEqual({
      kind: "cover",
      url: "https://i.scdn.co/image/later",
      sizes: ["tiny"],
    });
    expect(targets).toContainEqual({
      kind: "playlist",
      uri: "spotify:playlist:drive",
    });
    expect(targets.filter((target) => target.kind === "album")).toHaveLength(1);
  });

  it("prefetches covers for the first upcoming queue page", () => {
    const upcoming = Array.from({ length: PREFETCH_QUEUE_COVER_LIMIT + 4 }, (_, index) =>
      track({
        uri: `spotify:track:q${index}`,
        title: `Track ${index}`,
        coverUri: `https://i.scdn.co/image/q${index}`,
      }),
    );
    const targets = collectPrefetchTargets({ upcoming });
    const covers = targets.filter((target) => target.kind === "cover");

    expect(covers).toHaveLength(PREFETCH_QUEUE_COVER_LIMIT);
    expect(covers[0]).toEqual({
      kind: "cover",
      url: "https://i.scdn.co/image/q0",
      sizes: ["small", "feature"],
    });
    expect(covers[1]).toMatchObject({ sizes: ["tiny"] });
    expect(collectSnapshotCoverUrls(upcoming, 3)).toEqual([
      "https://i.scdn.co/image/q0",
      "https://i.scdn.co/image/q1",
      "https://i.scdn.co/image/q2",
    ]);
  });

  it("skips incomplete tracks and non-https covers", () => {
    const targets = collectPrefetchTargets({
      current: track({
        title: "Titel wird geladen…",
        creators: [],
        coverUri: "spotify:image:local",
        albumUri: "",
      }),
    });

    expect(targets).toEqual([]);
    expect(httpsCoverUrl("spotify:image:local")).toBeUndefined();
    expect(coverQueryKey("https://i.scdn.co/image/now")).toEqual([
      "cover",
      "https://i.scdn.co/image/now",
    ]);
  });
});
