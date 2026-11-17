/**
 * Libre hands out the queue as a leading window plus its full length. The
 * window grows while the listener scrolls and shrinks back once the queue
 * is closed, so background refreshes stay small even for liked songs.
 */
export const QUEUE_PAGE_SIZE = 100;

let windowLimit = QUEUE_PAGE_SIZE;

export function queueWindowLimit(): number {
  return windowLimit;
}

/** Returns false while the previous page is still being fetched. */
export function growQueueWindow(loadedItems: number, totalItems: number): boolean {
  if (loadedItems < windowLimit || loadedItems >= totalItems) return false;
  windowLimit += QUEUE_PAGE_SIZE;
  return true;
}

export function resetQueueWindow(): void {
  windowLimit = QUEUE_PAGE_SIZE;
}
