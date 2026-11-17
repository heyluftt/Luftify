import type { SharedQueueEntry, SharedQueueGroup } from "./listenTogetherTypes";

export interface IndexedEntry { entry: SharedQueueEntry; index: number }
export type QueueSegment =
  | { kind: "song"; item: IndexedEntry }
  | { kind: "group"; group: SharedQueueGroup; items: IndexedEntry[] };

/**
 * Consecutive songs of one playlist become a block. A song moved out of its
 * block stands alone; a block of one is just a song.
 */
export function queueSegments(entries: SharedQueueEntry[]): QueueSegment[] {
  const segments: QueueSegment[] = [];
  entries.forEach((entry, index) => {
    const last = segments.at(-1);
    if (entry.group && last?.kind === "group" && last.group.id === entry.group.id) {
      last.items.push({ entry, index });
    } else if (entry.group) {
      segments.push({ kind: "group", group: entry.group, items: [{ entry, index }] });
    } else {
      segments.push({ kind: "song", item: { entry, index } });
    }
  });
  return segments.map((segment) =>
    segment.kind === "group" && segment.items.length === 1 ? { kind: "song", item: segment.items[0]! } : segment);
}

/** The ids from `id` to the end of its block. */
export function blockTail(entries: SharedQueueEntry[], id: string): string[] {
  const start = entries.findIndex((entry) => entry.id === id);
  const group = entries[start]?.group?.id;
  if (start < 0 || !group) return [];
  const ids: string[] = [];
  for (let index = start; index < entries.length && entries[index]!.group?.id === group; index += 1) ids.push(entries[index]!.id);
  return ids;
}
