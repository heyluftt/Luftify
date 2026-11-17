import { describe, expect, it } from "vitest";

import type { QueueItem } from "@luft/protocol-types";
import { formatQueueCount, splitQueueSections } from "../src/features/queue/queuePresentation";

describe("formatQueueCount", () => {
  it("distinguishes the loaded prefix from the complete backend queue", () => {
    expect(formatQueueCount(13, 781)).toBe("13 von 781 Titeln");
  });

  it("uses the normal count when the complete queue is visible", () => {
    expect(formatQueueCount(13, 13)).toBe("13 Titel");
  });
});

describe("splitQueueSections", () => {
  const row = (uid?: string): QueueItem => ({
    item: { uri: `spotify:track:${uid}`, title: "T", source: "spotify", itemType: "track", creators: [], explicit: false, playable: true },
    ...(uid ? { uid } : {}),
  });

  it("separates manually queued titles from the context like Spotify", () => {
    const sections = splitQueueSections([row("q3"), row("q7"), row("c0"), row("c-back-2")]);
    expect(sections?.queued.map((entry) => entry.uid)).toEqual(["q3", "q7"]);
    expect(sections?.context.map((entry) => entry.uid)).toEqual(["c0", "c-back-2"]);
  });

  it("keeps one list for foreign ids or an unexpected order", () => {
    expect(splitQueueSections([row("spotify-uid-1"), row("c0")])).toBeUndefined();
    expect(splitQueueSections([row("c0"), row("q1")])).toBeUndefined();
    expect(splitQueueSections([row()])).toBeUndefined();
  });
});
