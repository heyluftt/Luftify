import type { QueueItem } from "@luft/protocol-types";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useState, type RefObject } from "react";

import { queueItemKey } from "./queueReorder";

/** Short lists render plainly; drag and drop stays trivially correct there. */
const VIRTUAL_THRESHOLD = 60;
const SCROLL_PARENT = ".queue-panel-scroll, .page-scroll";

interface QueueVirtualRowsOptions {
  listRef: RefObject<HTMLDivElement | null>;
  items: QueueItem[];
  estimateSize: number;
  /** Kept rendered while off screen, e.g. the row being dragged. */
  pinnedIndex?: number | undefined;
  /** Changes whenever content above the list may move it. */
  layoutKey?: unknown;
}

export function useQueueVirtualRows({
  listRef, items, estimateSize, pinnedIndex, layoutKey,
}: QueueVirtualRowsOptions) {
  const enabled = items.length > VIRTUAL_THRESHOLD;
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    const parent = enabled ? list?.closest<HTMLElement>(SCROLL_PARENT) ?? null : null;
    setScrollParent(parent);
    setMeasured(true);
    if (!list || !parent) return;
    const measure = () => {
      const margin = list.getBoundingClientRect().top
        - parent.getBoundingClientRect().top
        + parent.scrollTop;
      setScrollMargin((previous) => Math.abs(previous - margin) < 1 ? previous : margin);
    };
    measure();
    // Content above the list (current title, queued section) can grow late.
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    for (const child of Array.from(parent.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [enabled, layoutKey, listRef]);

  const virtualizer = useVirtualizer({
    count: enabled && scrollParent ? items.length : 0,
    getScrollElement: () => scrollParent,
    estimateSize: () => estimateSize,
    overscan: 10,
    scrollMargin,
    getItemKey: (index) => {
      const entry = items[index];
      return entry ? queueItemKey(entry, index) : index;
    },
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (
        pinnedIndex === undefined
        || pinnedIndex >= items.length
        || indexes.includes(pinnedIndex)
      ) return indexes;
      return [...indexes, pinnedIndex].sort((left, right) => left - right);
    },
  });

  return {
    /** Long list whose scroll parent is not known yet (first render). */
    pending: enabled && !measured,
    virtual: enabled && scrollParent !== null,
    virtualizer,
    scrollMargin,
  };
}
