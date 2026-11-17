import { describe, expect, it } from "vitest";
import type { MediaItem, QueueItem } from "@luft/protocol-types";
import {
  collapseQueueItems,
  hasIncompleteQueueItems,
  LOADING_QUEUE_TITLE,
  preferCompleteMediaItem,
  QUEUE_METADATA_WINDOW_SIZE,
  sanitizeQueueState,
} from "../src/features/queue/sanitizeQueue";

function track(uri: string, title: string): MediaItem {
  return {
    uri,
    source: "spotify",
    itemType: "track",
    title,
    creators: [{ name: title === "Unbekannter Titel" ? "Unbekannter Künstler" : "Atlas" }],
    explicit: false,
    playable: true,
  };
}

function entry(uri: string, title: string, uid?: string): QueueItem {
  return {
    item: track(uri, title),
    ...(uid ? { uid } : {}),
  };
}

describe("sanitizeQueueState", () => {
  it("collapses alternating real/stub pairs of the same URI", () => {
    const collapsed = collapseQueueItems([
      entry("spotify:track:one", "Airborne", "one-a"),
      entry("spotify:track:one", "Unbekannter Titel", "one-b"),
      entry("spotify:track:two", "Nocturne", "two-a"),
      entry("spotify:track:two", "Unbekannter Titel", "two-b"),
    ]);

    expect(collapsed.map((item) => item.item.title)).toEqual([
      "Airborne",
      "Nocturne",
    ]);
  });

  it("keeps the complete row when the stub comes first", () => {
    const collapsed = collapseQueueItems([
      entry("spotify:track:one", "Unbekannter Titel", "stub"),
      entry("spotify:track:one", "Airborne", "real"),
    ]);

    expect(collapsed).toEqual([
      entry("spotify:track:one", "Airborne", "real"),
    ]);
  });

  it("keeps a title queued twice as two rows", () => {
    const collapsed = collapseQueueItems([
      entry("spotify:track:one", "Airborne", "q1"),
      entry("spotify:track:one", "Airborne", "q2"),
    ]);

    expect(collapsed.map((item) => item.uid)).toEqual(["q1", "q2"]);
  });

  it("drops leftover unknown rows and delimiter URIs", () => {
    const sanitized = sanitizeQueueState({
      revision: 4,
      items: [
        entry("spotify:track:one", "Airborne", "one"),
        entry("spotify:delimiter", "Unbekannter Titel", "gap"),
        entry("spotify:track:ghost", "Unbekannter Titel", "ghost"),
      ],
    });

    expect(sanitized.items).toEqual([
      entry("spotify:track:one", "Airborne", "one"),
    ]);
  });

  it("does not promote a later cached title across a loading predecessor", () => {
    const sanitized = sanitizeQueueState({
      revision: 2,
      currentItem: track("spotify:track:now", LOADING_QUEUE_TITLE),
      items: [
        entry("spotify:track:one", LOADING_QUEUE_TITLE, "c0"),
        entry("spotify:track:two", "Nightcall", "c1"),
      ],
    });

    expect(sanitized.currentItem).toBeUndefined();
    expect(sanitized.items).toEqual([]);
  });

  it("keeps the resolved prefix while the following queue window hydrates", () => {
    const sanitized = sanitizeQueueState({
      revision: 3,
      items: [
        entry("spotify:track:one", "Airborne", "c0"),
        entry("spotify:track:two", LOADING_QUEUE_TITLE, "c1"),
        entry("spotify:track:three", "Nightcall", "c2"),
      ],
    });

    expect(sanitized.items.map((item) => item.item.title)).toEqual([
      "Airborne",
    ]);
  });

  it("only polls quickly while the leading metadata window is incomplete", () => {
    const resolvedWindow = Array.from(
      { length: QUEUE_METADATA_WINDOW_SIZE },
      (_, index) => entry(
        `spotify:track:${String(index).padStart(22, "0")}`,
        `Track ${index}`,
        `c${index}`,
      ),
    );

    expect(hasIncompleteQueueItems({
      items: [
        ...resolvedWindow,
        entry("spotify:track:9999999999999999999999", LOADING_QUEUE_TITLE, "later"),
      ],
    })).toBe(false);
    expect(hasIncompleteQueueItems({
      items: [
        ...resolvedWindow.slice(0, -1),
        entry("spotify:track:8888888888888888888888", LOADING_QUEUE_TITLE, "front"),
      ],
    })).toBe(true);
  });

  it("shows at most the twelve-title metadata window even when more rows are cached", () => {
    const cachedItems = Array.from(
      { length: 32 },
      (_, index) => entry(
        `spotify:track:${String(index).padStart(22, "0")}`,
        `Track ${index}`,
        `c${index}`,
      ),
    );

    const sanitized = sanitizeQueueState({
      revision: 5,
      items: cachedItems,
    });

    expect(sanitized.items).toHaveLength(QUEUE_METADATA_WINDOW_SIZE);
    expect(sanitized.items.at(-1)?.item.title).toBe("Track 11");
  });

  it("keeps unresolved rows of a windowed queue in place", () => {
    const items = Array.from({ length: 30 }, (_, index) =>
      entry(`spotify:track:${index}`, index === 3 ? LOADING_QUEUE_TITLE : `Track ${index}`, `c${index}`),
    );
    const sanitized = sanitizeQueueState({ items, revision: 1, totalItems: 400 });

    expect(sanitized.items).toHaveLength(30);
    expect(sanitized.items[3]?.item.title).toBe(LOADING_QUEUE_TITLE);
    expect(sanitized.items[4]?.item.title).toBe("Track 4");
  });

  it("prefers the playing track when the queue current item is a stub", () => {
    const current = preferCompleteMediaItem(
      track("spotify:track:one", "Unbekannter Titel"),
      track("spotify:track:one", "Airborne"),
    );

    expect(current?.title).toBe("Airborne");
    expect(
      preferCompleteMediaItem(
        track("spotify:track:one", "Unbekannter Titel"),
        track("spotify:track:other", "Other"),
      )?.title,
    ).toBe("Unbekannter Titel");
  });
});
