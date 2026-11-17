import { describe, expect, it } from "vitest";
import { displayedOrder, dragTarget, placementFor, rowShift } from "../src/features/queue/queueDragGeometry";

describe("Ziehen in der Warteschlange", () => {
  it("findet die Lücke nach gezogenen Zeilen und bleibt in der Liste", () => {
    expect(dragTarget(1, 0, 60, 5)).toBe(1);
    expect(dragTarget(1, 29, 60, 5)).toBe(1);
    expect(dragTarget(1, 31, 60, 5)).toBe(2);
    expect(dragTarget(1, -100, 60, 5)).toBe(0);
    expect(dragTarget(1, 900, 60, 5)).toBe(4);
  });

  it("lässt nur die überquerten Zeilen ausweichen und zeigt die neuen Nummern", () => {
    // Zeile 1 wird hinter Zeile 3 gezogen.
    expect([0, 1, 2, 3, 4].map((index) => rowShift(index, 1, 3))).toEqual([0, 0, -1, -1, 0]);
    expect([0, 1, 2, 3, 4].map((index) => displayedOrder(index, 1, 3))).toEqual([0, 3, 1, 2, 4]);
    // Zeile 3 wird vor Zeile 1 gezogen.
    expect([0, 1, 2, 3, 4].map((index) => rowShift(index, 3, 1))).toEqual([0, 1, 1, 0, 0]);
    expect(placementFor(3, 1)).toEqual({ anchorIndex: 1, placement: "before" });
    expect(placementFor(1, 3)).toEqual({ anchorIndex: 3, placement: "after" });
    expect(placementFor(2, 2)).toBeUndefined();
  });
});
