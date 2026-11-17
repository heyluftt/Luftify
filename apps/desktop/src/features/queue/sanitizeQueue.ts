import type {
  MediaItem,
  QueueItem,
  QueueState,
} from "@luft/protocol-types";

export const UNKNOWN_QUEUE_TITLE = "Unbekannter Titel";
export const LOADING_QUEUE_TITLE = "Titel wird geladen…";
export const QUEUE_METADATA_WINDOW_SIZE = 12;

export function isPlayableQueueUri(uri: string): boolean {
  if (!uri) {
    return false;
  }
  if (
    /spotify:(delimiter|hidden|interruption|ad|restriction)\b/i.test(uri)
  ) {
    return false;
  }
  return /^(spotify|mock):(track|episode|local):/i.test(uri);
}

export function isIncompleteQueueItem(item: MediaItem): boolean {
  const title = item.title.trim();
  return title === "" || title === UNKNOWN_QUEUE_TITLE || title === LOADING_QUEUE_TITLE;
}

export function isLoadingQueueTitle(title: string): boolean {
  return title.trim() === LOADING_QUEUE_TITLE;
}

export function hasIncompleteQueueItems(state: Pick<QueueState, "items">): boolean {
  return state.items
    .slice(0, QUEUE_METADATA_WINDOW_SIZE)
    .some((entry) => isIncompleteQueueItem(entry.item));
}

export function preferCompleteMediaItem(
  queueCurrent: MediaItem | undefined,
  playbackCurrent: MediaItem | undefined,
): MediaItem | undefined {
  if (!queueCurrent) {
    return playbackCurrent;
  }
  if (
    !isIncompleteQueueItem(queueCurrent)
    || !playbackCurrent
    || isIncompleteQueueItem(playbackCurrent)
  ) {
    return queueCurrent;
  }
  if (playbackCurrent.uri && playbackCurrent.uri !== queueCurrent.uri) {
    return queueCurrent;
  }
  return {
    ...queueCurrent,
    ...playbackCurrent,
    uri: queueCurrent.uri || playbackCurrent.uri,
  };
}

export function collapseQueueItems(items: QueueItem[]): QueueItem[] {
  const collapsed: QueueItem[] = [];
  for (const entry of items) {
    if (!isPlayableQueueUri(entry.item.uri)) {
      continue;
    }
    const previous = collapsed.at(-1);
    // A stub next to its real row is an echo of the same entry. Two complete
    // rows with distinct uids are a title queued twice and both stay.
    const sameEntry = previous !== undefined
      && previous.item.uri === entry.item.uri
      && (isIncompleteQueueItem(previous.item)
        || isIncompleteQueueItem(entry.item)
        || !previous.uid
        || !entry.uid
        || previous.uid === entry.uid);
    if (previous && sameEntry) {
      if (
        isIncompleteQueueItem(previous.item)
        && !isIncompleteQueueItem(entry.item)
      ) {
        collapsed[collapsed.length - 1] = entry;
      }
      continue;
    }
    collapsed.push(entry);
  }
  return collapsed;
}

export function sanitizeQueueState(
  state: QueueState,
  playbackCurrent?: MediaItem,
): QueueState {
  const currentItem = preferCompleteMediaItem(
    state.currentItem,
    playbackCurrent,
  );
  const visibleCurrent =
    currentItem && !isIncompleteQueueItem(currentItem)
      ? currentItem
      : undefined;
  const collapsedItems = collapseQueueItems(state.items);
  const { currentItem: _currentItem, ...rest } = state;
  return {
    ...rest,
    ...(visibleCurrent ? { currentItem: visibleCurrent } : {}),
    items: state.totalItems !== undefined
      ? collapsedItems
      : resolvedWindow(collapsedItems),
  };
}

// Windowed queues (Libre) keep unresolved rows in place as loading rows.
// Other engines have no way to resolve them later, so their list ends at
// the first gap: moving a resolved row across an unresolved predecessor
// would make a far-away cached title look like the immediate successor.
function resolvedWindow(items: QueueItem[]): QueueItem[] {
  const firstIncomplete = items.findIndex((entry) =>
    isIncompleteQueueItem(entry.item)
  );
  const resolvedPrefix = firstIncomplete < 0
    ? items
    : items.slice(0, firstIncomplete);
  return resolvedPrefix.slice(0, QUEUE_METADATA_WINDOW_SIZE);
}
