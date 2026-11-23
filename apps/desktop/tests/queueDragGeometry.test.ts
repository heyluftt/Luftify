import { describe, expect, it } from "vitest";
import { displayedOrder, dragTarget, placementFor, rowShift } from "../src/features/queue/queueDragGeometry";

describe("Dragging in the queue", () => {
  it("finds the gap by rows dragged and stays inside the list", () => {
    expect(dragTarget(1, 0, 60, 5)).toBe(1);
    expect(dragTarget(1, 29, 60, 5)).toBe(1);
    expect(dragTarget(1, 31, 60, 5)).toBe(2);
    expect(dragTarget(1, -100, 60, 5)).toBe(0);
    expect(dragTarget(1, 900, 60, 5)).toBe(4);
  });

  it("moves only the rows crossed and shows the new numbers", () => {
    // Row 1 is dragged behind row 3.
    expect([0, 1, 2, 3, 4].map((index) => rowShift(index, 1, 3))).toEqual([0, 0, -1, -1, 0]);
    expect([0, 1, 2, 3, 4].map((index) => displayedOrder(index, 1, 3))).toEqual([0, 3, 1, 2, 4]);
    // Row 3 is dragged before row 1.
    expect([0, 1, 2, 3, 4].map((index) => rowShift(index, 3, 1))).toEqual([0, 1, 1, 0, 0]);
    expect(placementFor(3, 1)).toEqual({ anchorIndex: 1, placement: "before" });
    expect(placementFor(1, 3)).toEqual({ anchorIndex: 3, placement: "after" });
    expect(placementFor(2, 2)).toBeUndefined();
  });
});
