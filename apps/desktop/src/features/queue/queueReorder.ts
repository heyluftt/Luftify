import type {
  QueueItem,
  QueueItemReference,
  QueuePlacement,
  QueueReorderRequest,
} from "@luft/protocol-types";

export function queueItemKey(
  entry: QueueItem,
  index: number,
): string {
  return entry.uid ?? `${entry.item.uri}:${index}`;
}

export function createQueueReorderRequest(
  items: QueueItem[],
  sourceIndex: number,
  anchorIndex: number,
  placement: QueuePlacement,
  expectedRevision: number,
): QueueReorderRequest | undefined {
  const moved = items[sourceIndex];
  const anchor = items[anchorIndex];
  if (
    !moved
    || !anchor
    || sourceIndex === anchorIndex
    || !queueMoveChangesOrder(
      sourceIndex,
      anchorIndex,
      placement,
    )
  ) {
    return undefined;
  }

  const movedReference = queueItemReference(moved, items);
  const anchorReference = queueItemReference(anchor, items);
  if (!movedReference || !anchorReference) {
    return undefined;
  }

  return {
    moved: movedReference,
    anchor: anchorReference,
    placement,
    expectedRevision,
  };
}

export function applyQueueReorder(
  items: QueueItem[],
  request: QueueReorderRequest,
): QueueItem[] {
  const sourceIndex = findReferenceIndex(items, request.moved);
  if (sourceIndex < 0) return items;

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return items;

  const anchorIndex = findReferenceIndex(next, request.anchor);
  if (anchorIndex < 0) return items;

  next.splice(
    request.placement === "before"
      ? anchorIndex
      : anchorIndex + 1,
    0,
    moved,
  );
  return next;
}

export function queueMoveChangesOrder(
  sourceIndex: number,
  anchorIndex: number,
  placement: QueuePlacement,
): boolean {
  if (sourceIndex === anchorIndex) return false;
  if (placement === "before") {
    return sourceIndex !== anchorIndex - 1;
  }
  return sourceIndex !== anchorIndex + 1;
}

function queueItemReference(
  entry: QueueItem,
  allItems: QueueItem[],
): QueueItemReference | undefined {
  if (entry.uid) {
    return { uri: entry.item.uri, uid: entry.uid };
  }

  const occurrences = allItems.filter(
    (candidate) => candidate.item.uri === entry.item.uri,
  ).length;
  return occurrences === 1
    ? { uri: entry.item.uri }
    : undefined;
}

function findReferenceIndex(
  items: QueueItem[],
  reference: QueueItemReference,
): number {
  if (reference.uid) {
    return items.findIndex(
      (entry) => entry.uid === reference.uid,
    );
  }

  const matches = items
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) => entry.item.uri === reference.uri,
    );
  return matches.length === 1 ? matches[0]!.index : -1;
}
