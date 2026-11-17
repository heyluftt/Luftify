import type { QueueItem } from "@luft/protocol-types";
import { t } from "../../i18n";

export function formatQueueCount(
  visibleItems: number,
  totalItems: number,
): string {
  if (totalItems > visibleItems) {
    return t("queue.countOf", { visible: visibleItems, total: totalItems });
  }
  return t(totalItems === 1 ? "queue.countOne" : "queue.count", { count: totalItems });
}

export interface QueueSections {
  /** Titles the listener queued manually; they always play first. */
  queued: QueueItem[];
  /** The rest of the playing context (playlist, album, mix). */
  context: QueueItem[];
}

// Libre marks rows with "q<n>" (manual) and "c…" (context). Other engines use
// their own ids; then the queue stays one list instead of guessing.
const QUEUED_UID = /^q\d+$/;
const CONTEXT_UID = /^c/;

export function splitQueueSections(items: QueueItem[]): QueueSections | undefined {
  if (!items.every((entry) => entry.uid && (QUEUED_UID.test(entry.uid) || CONTEXT_UID.test(entry.uid)))) {
    return undefined;
  }
  const queued = items.filter((entry) => QUEUED_UID.test(entry.uid!));
  // The backend keeps manual rows ahead of the context; anything else means
  // an unexpected order, which a split view would misrepresent.
  if (items.slice(0, queued.length).some((entry) => !QUEUED_UID.test(entry.uid!))) {
    return undefined;
  }
  return { queued, context: items.slice(queued.length) };
}
