import type {
  MediaItem,
  QueueItem,
  QueuePlacement,
} from "@luft/protocol-types";
import type { VirtualItem } from "@tanstack/react-virtual";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  TrackActionsMenu,
  type TrackActionsView,
} from "../../components/track-actions/TrackActionsMenu";
import { t } from "../../i18n";
import { QueueTrackRow } from "./QueueTrackRow";
import { displayedOrder, rowShift } from "./queueDragGeometry";
import { queueItemKey } from "./queueReorder";
import { isIncompleteQueueItem } from "./sanitizeQueue";
import { useQueueDragReorder } from "./useQueueDragReorder";
import { useQueueVirtualRows } from "./useQueueVirtualRows";

interface OpenTrackActions {
  item: MediaItem;
  /** Present only when this row can be removed unambiguously. */
  removable?: QueueItem;
  position: { x: number; y: number };
  view: TrackActionsView;
}

export interface QueueTrackListProps {
  items: QueueItem[];
  canRemove: boolean;
  canReorder?: boolean;
  reorderPending?: boolean;
  /** uid (or URI for rows without one) of the row being removed. */
  removingKey?: string | null;
  onPlay: (uri: string) => void | Promise<void>;
  playOnRowClick?: boolean;
  onRemove?: ((entry: QueueItem) => void | Promise<void>) | undefined;
  onReorder?: ((
    sourceIndex: number,
    anchorIndex: number,
    placement: QueuePlacement,
  ) => void) | undefined;
  compact?: boolean;
  emptyLabel?: string;
  showActions?: boolean;
  saved?: boolean | ((uri: string) => boolean);
  onSavedChange?: ((uri: string, saved: boolean) => void) | undefined;
  /** More rows exist beyond `items`; called when the end comes into view. */
  onEndReached?: (() => void) | undefined;
  /** Placeholder rows currently rendered, so their titles can be loaded. */
  onVisiblePlaceholders?: ((uris: string[]) => void) | undefined;
  /** Changes whenever content above the list may move it. */
  layoutKey?: unknown;
}

const END_REACHED_ROWS = 20;
const PENDING_ROWS = 20;
const PLACEHOLDER_REPORT_DELAY_MS = 140;
const PLACEHOLDER_REPORT_MAX = 48;

export function QueueTrackList({
  items,
  canRemove,
  canReorder = false,
  reorderPending = false,
  removingKey = null,
  onPlay,
  playOnRowClick = false,
  onRemove,
  onReorder,
  compact = false,
  emptyLabel,
  showActions = true,
  saved = false,
  onSavedChange,
  onEndReached,
  onVisiblePlaceholders,
  layoutKey,
}: QueueTrackListProps) {
  const [openActions, setOpenActions] =
    useState<OpenTrackActions>();
  const listRef = useRef<HTMLDivElement>(null);
  const reorderEnabled =
    canReorder && Boolean(onReorder) && !reorderPending;
  const drag = useQueueDragReorder({
    enabled: reorderEnabled,
    count: items.length,
    onReorder: (sourceIndex, anchorIndex, placement) =>
      onReorder?.(sourceIndex, anchorIndex, placement),
  });
  const dragState = drag.state;
  // While settling, the indexes already belong to the new order.
  const moving = dragState?.phase === "settled" ? undefined : dragState;
  const { pending, virtual, virtualizer, scrollMargin } = useQueueVirtualRows({
    listRef,
    items,
    estimateSize: compact ? 54 : 61,
    pinnedIndex: moving?.sourceIndex,
    layoutKey,
  });

  // The reordered queue arrived: before it is painted, the drag ends where
  // the rows already stand.
  const settle = drag.settle;
  useLayoutEffect(() => settle(), [items, settle]);

  const uriOccurrences = useMemo(() => {
    const occurrences = new Map<string, number>();

    for (const { item } of items) {
      occurrences.set(
        item.uri,
        (occurrences.get(item.uri) ?? 0) + 1,
      );
    }

    return occurrences;
  }, [items]);

  const virtualRows = virtual ? virtualizer.getVirtualItems() : [];
  // Until the scroll parent is known, a long list shows only its head.
  const plainRows = pending ? Math.min(items.length, PENDING_ROWS) : items.length;
  const firstRendered = virtual ? virtualRows[0]?.index ?? 0 : 0;
  const lastRendered = virtual
    ? virtualRows.at(-1)?.index ?? -1
    : plainRows - 1;

  useEffect(() => {
    if (pending) return;
    if (onEndReached && lastRendered >= items.length - END_REACHED_ROWS) {
      onEndReached();
    }
  }, [items.length, lastRendered, onEndReached, pending]);

  const placeholderKey = useMemo(() => {
    const uris: string[] = [];
    for (let index = firstRendered; index <= lastRendered; index += 1) {
      const entry = items[index];
      if (entry && isIncompleteQueueItem(entry.item)) uris.push(entry.item.uri);
      if (uris.length >= PLACEHOLDER_REPORT_MAX) break;
    }
    return uris.join("\n");
  }, [firstRendered, items, lastRendered]);

  // Waits for scrolling to settle so a fast fling doesn't load every row
  // it passes.
  useEffect(() => {
    if (!onVisiblePlaceholders || !placeholderKey) return;
    const timer = window.setTimeout(
      () => onVisiblePlaceholders(placeholderKey.split("\n")),
      PLACEHOLDER_REPORT_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [onVisiblePlaceholders, placeholderKey]);

  if (items.length === 0) {
    return (
      <div className="queue-track-empty" role="status">
        {emptyLabel ?? t("queue.listEmpty")}
      </div>
    );
  }

  const listClassName = [
    "queue-track-list",
    compact ? "queue-track-list-compact" : "",
    moving ? "is-reordering" : "",
    dragState?.phase === "settled" ? "is-settling" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const openActionsAt = (
    item: MediaItem,
    removable: QueueItem | undefined,
    position: { x: number; y: number },
  ) => setOpenActions({
    item,
    ...(removable ? { removable } : {}),
    position,
    view: "actions",
  });

  const renderRow = (
    index: number,
    layout?: VirtualItem,
  ) => {
    const entry = items[index];
    if (!entry) return null;
    // A uid pins the exact row; without one only a unique URI is safe.
    const identifiable =
      Boolean(entry.uid) || uriOccurrences.get(entry.item.uri) === 1;
    const removalPossible = canRemove && Boolean(onRemove);

    return (
      <QueueTrackRow
        key={layout ? String(layout.key) : queueItemKey(entry, index)}
        entry={entry}
        index={index}
        count={items.length}
        rowRef={layout ? virtualizer.measureElement : undefined}
        style={layout
          ? { transform: `translateY(${layout.start - scrollMargin}px)` }
          : undefined}
        playOnRowClick={playOnRowClick}
        showActions={showActions}
        canReorder={canReorder}
        reorderEnabled={reorderEnabled}
        removable={removalPossible && identifiable}
        removalAmbiguous={removalPossible && !identifiable}
        removing={removingKey === queueRemovalKey(entry)}
        order={moving ? displayedOrder(index, moving.sourceIndex, moving.targetIndex) : index}
        dragPhase={moving?.sourceIndex === index ? moving.phase : undefined}
        shift={moving ? rowShift(index, moving.sourceIndex, moving.targetIndex) : 0}
        drag={drag}
        onPlay={onPlay}
        onRemove={(row) => void onRemove?.(row)}
        onReorder={onReorder}
        onOpenActions={openActionsAt}
      />
    );
  };

  return (
    <>
      <div
        ref={listRef}
        className={listClassName}
        style={moving ? { "--queue-pitch": `${moving.pitch}px` } as CSSProperties : undefined}
        role="list"
        aria-label={t("queue.list")}
      >
        {virtual ? (
          <div
            className="queue-track-virtual"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualRows.map((row) => renderRow(row.index, row))}
          </div>
        ) : (
          items.slice(0, plainRows).map((_, index) => renderRow(index))
        )}
      </div>

      {openActions && (
        <TrackActionsMenu
          key={`${openActions.item.uri}:${openActions.position.x}:${openActions.position.y}`}
          track={openActions.item}
          position={openActions.position}
          initialView={openActions.view}
          canQueue={false}
          saved={
            typeof saved === "function"
              ? saved(openActions.item.uri)
              : saved
          }
          onSavedChange={onSavedChange}
          onRemoveFromQueue={
            openActions.removable && onRemove
              ? () => onRemove(openActions.removable!)
              : undefined
          }
          onClose={() => setOpenActions(undefined)}
        />
      )}
    </>
  );
}

export function queueRemovalKey(entry: QueueItem): string {
  return entry.uid || entry.item.uri;
}
