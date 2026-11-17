import { describe, expect, it } from "vitest";
import { blockTail, queueSegments } from "../src/features/listen-together/queueSegments";
import type { SharedQueueEntry } from "../src/features/listen-together/listenTogetherTypes";

const entry = (id: string, group?: string): SharedQueueEntry => ({
  id, track: { provider: "spotify", uri: `spotify:track:${id}` }, ...(group ? { group: { id: group, name: group } } : {}),
});

describe("queue segments", () => {
  it("groups consecutive songs of one playlist and leaves strays alone", () => {
    const items = [entry("a", "p"), entry("b", "p"), entry("c"), entry("d", "p"), entry("e", "q"), entry("f", "q")];
    expect(queueSegments(items).map((s) => s.kind === "group" ? `${s.group.id}:${s.items.length}` : s.item.entry.id))
      .toEqual(["p:2", "c", "d", "q:2"]);
  });

  it("trims from a song to the end of its block only", () => {
    const items = [entry("a", "p"), entry("b", "p"), entry("c", "p"), entry("d")];
    expect(blockTail(items, "b")).toEqual(["b", "c"]);
    expect(blockTail(items, "d")).toEqual([]);
  });
});
