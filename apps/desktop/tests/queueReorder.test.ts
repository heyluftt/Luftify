import type { QueueItem } from "@luft/protocol-types";
import { describe, expect, it } from "vitest";

import {
  applyQueueReorder,
  createQueueReorderRequest,
} from "../src/features/queue/queueReorder";

const ITEMS: QueueItem[] = ["one", "two", "three"].map(
  (name) => ({
    uid: `uid-${name}`,
    item: {
      uri: `spotify:track:${name}`,
      source: "spotify",
      itemType: "track",
      title: name,
      creators: [{ name: "Artist" }],
      explicit: false,
      playable: true,
    },
  }),
);

describe("queue reorder", () => {
  it("moves an entry before an earlier anchor", () => {
    const request = createQueueReorderRequest(
      ITEMS,
      2,
      0,
      "before",
      7,
    );

    expect(request).toBeDefined();
    expect(
      applyQueueReorder(ITEMS, request!).map(
        (entry) => entry.uid,
      ),
    ).toEqual(["uid-three", "uid-one", "uid-two"]);
  });

  it("moves an entry after a later anchor", () => {
    const request = createQueueReorderRequest(
      ITEMS,
      0,
      2,
      "after",
      7,
    );

    expect(request).toBeDefined();
    expect(
      applyQueueReorder(ITEMS, request!).map(
        (entry) => entry.uid,
      ),
    ).toEqual(["uid-two", "uid-three", "uid-one"]);
  });

  it("does not address duplicate URI entries without native UIDs", () => {
    const duplicate = ITEMS.map((entry) => ({
      uid: undefined,
      item: { ...entry.item, uri: "spotify:track:same" },
    })).map(({ item }) => ({ item }));

    expect(
      createQueueReorderRequest(
        duplicate,
        0,
        2,
        "after",
        7,
      ),
    ).toBeUndefined();
  });
});
