import type { QueuePlacement } from "@luft/protocol-types";

/** Where a row dragged `offset` pixels from `sourceIndex` would land. */
export function dragTarget(sourceIndex: number, offset: number, pitch: number, count: number): number {
  if (pitch <= 0 || count <= 0) return sourceIndex;
  const target = sourceIndex + Math.round(offset / pitch);
  return Math.min(count - 1, Math.max(0, target));
}

/** The move as the queue expects it; `undefined` when nothing moves. */
export function placementFor(
  sourceIndex: number,
  targetIndex: number,
): { anchorIndex: number; placement: QueuePlacement } | undefined {
  if (targetIndex === sourceIndex) return undefined;
  return {
    anchorIndex: targetIndex,
    placement: targetIndex > sourceIndex ? "after" : "before",
  };
}

/**
 * How a row moves while another one is dragged: the rows between source and
 * target step aside by one place. Returns -1 (up), 1 (down) or 0.
 */
export function rowShift(index: number, sourceIndex: number, targetIndex: number): -1 | 0 | 1 {
  if (index === sourceIndex) return 0;
  if (targetIndex > sourceIndex && index > sourceIndex && index <= targetIndex) return -1;
  if (targetIndex < sourceIndex && index < sourceIndex && index >= targetIndex) return 1;
  return 0;
}

/** The position number a row shows while a drag is under way. */
export function displayedOrder(index: number, sourceIndex: number, targetIndex: number): number {
  if (index === sourceIndex) return targetIndex;
  return index + rowShift(index, sourceIndex, targetIndex);
}
