import type { QueuePlacement } from "@luft/protocol-types";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { queueMoveChangesOrder } from "./queueReorder";
import { dragTarget, placementFor } from "./queueDragGeometry";

interface ActivePointerDrag {
  pointerId: number;
  sourceIndex: number;
  startX: number;
  startY: number;
  started: boolean;
  scrollContainer?: HTMLElement;
  startScrollTop: number;
  row?: HTMLElement;
  pitch: number;
}

interface QueueDragReorderOptions {
  enabled: boolean;
  count: number;
  onReorder: (
    sourceIndex: number,
    anchorIndex: number,
    placement: QueuePlacement,
  ) => void;
}

/** `settled`: the reordered queue arrived; one frame without transitions. */
export type QueueDragPhase = "dragging" | "dropping" | "settled";

export interface QueueDragState {
  sourceIndex: number;
  /** Where the dragged title lands if it is let go now. */
  targetIndex: number;
  /** Distance between two rows; the others move by it to open the gap. */
  pitch: number;
  phase: QueueDragPhase;
}

const DRAG_START_DISTANCE_PX = 4;
/** Longer than any optimistic reorder; then the rows slide back. */
const DROP_SETTLE_TIMEOUT_MS = 1500;
const DRAG_OFFSET = "--queue-drag-y";

/**
 * The dragged row follows the pointer while the others slide aside to open
 * the gap where it will land. On release it glides into that gap and stays
 * there until the reordered queue arrives (`settle`).
 */
export function useQueueDragReorder({
  enabled,
  count,
  onReorder,
}: QueueDragReorderOptions) {
  const [state, setStateValue] = useState<QueueDragState>();
  const stateRef = useRef<QueueDragState | undefined>(undefined);
  const activeDrag = useRef<ActivePointerDrag | undefined>(undefined);
  const dropTimer = useRef<number | undefined>(undefined);

  const setState = useCallback((next: QueueDragState | undefined) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);

  const reset = useCallback(() => {
    window.clearTimeout(dropTimer.current);
    activeDrag.current?.row?.style.removeProperty(DRAG_OFFSET);
    activeDrag.current = undefined;
    setState(undefined);
    document.body.classList.remove("queue-reorder-active");
  }, [setState]);

  useEffect(() => reset, [reset]);

  /**
   * The reordered queue arrived: the rows now stand where they were shown,
   * so the offsets go without any transition, then the drag ends.
   */
  const settle = useCallback(() => {
    const current = stateRef.current;
    if (current?.phase !== "dropping") return;
    window.clearTimeout(dropTimer.current);
    activeDrag.current?.row?.style.removeProperty(DRAG_OFFSET);
    activeDrag.current = undefined;
    setState({ ...current, phase: "settled" });
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (stateRef.current?.phase === "settled") setState(undefined);
    }));
  }, [setState]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
      if (!enabled || event.isPrimary === false || event.button > 0) return;
      if (stateRef.current) reset();

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const scrollContainer = findScrollContainer(event.currentTarget);
      activeDrag.current = {
        pointerId: event.pointerId,
        sourceIndex: index,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
        ...(scrollContainer ? { scrollContainer } : {}),
        startScrollTop: scrollContainer?.scrollTop ?? 0,
        pitch: 0,
      };
    },
    [enabled, reset],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const active = activeDrag.current;
      if (!enabled || !active || active.pointerId !== event.pointerId) return;

      if (!active.started) {
        if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < DRAG_START_DISTANCE_PX) {
          return;
        }
        const row = event.currentTarget.closest<HTMLElement>("[data-queue-index]") ?? undefined;
        active.started = true;
        if (row) active.row = row;
        active.pitch = rowPitch(row, active.sourceIndex);
        document.body.classList.add("queue-reorder-active");
      }

      event.preventDefault();
      autoScroll(active.scrollContainer, event.clientY);

      const scrolled = (active.scrollContainer?.scrollTop ?? 0) - active.startScrollTop;
      const offset = event.clientY - active.startY + scrolled;
      if (!Number.isFinite(offset)) return;
      active.row?.style.setProperty(DRAG_OFFSET, `${offset}px`);

      const targetIndex = dragTarget(active.sourceIndex, offset, active.pitch, count);
      const current = stateRef.current;
      if (current?.targetIndex !== targetIndex || current.phase !== "dragging") {
        setState({ sourceIndex: active.sourceIndex, targetIndex, pitch: active.pitch, phase: "dragging" });
      }
    },
    [count, enabled, setState],
  );

  const releasePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const active = activeDrag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const current = stateRef.current;
      const move = current && placementFor(current.sourceIndex, current.targetIndex);
      document.body.classList.remove("queue-reorder-active");

      if (
        enabled
        && active.started
        && current
        && move
        && queueMoveChangesOrder(current.sourceIndex, move.anchorIndex, move.placement)
      ) {
        // Glide into the gap and wait there for the reordered queue.
        active.row?.style.setProperty(
          DRAG_OFFSET,
          `${(current.targetIndex - current.sourceIndex) * current.pitch}px`,
        );
        setState({ ...current, phase: "dropping" });
        dropTimer.current = window.setTimeout(reset, DROP_SETTLE_TIMEOUT_MS);
        onReorder(current.sourceIndex, move.anchorIndex, move.placement);
      } else {
        reset();
      }
      releasePointer(event);
    },
    [enabled, onReorder, reset, setState],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const active = activeDrag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      reset();
      releasePointer(event);
    },
    [reset],
  );

  const onLostPointerCapture = useCallback(() => {
    if (stateRef.current?.phase !== "dropping") reset();
  }, [reset]);

  return {
    state,
    settle,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
  };
}

/** Distance from one row to the next, measured on the rendered rows. */
function rowPitch(row: HTMLElement | undefined, index: number): number {
  if (!row) return 0;
  const list = row.parentElement;
  const neighbour = list?.querySelector<HTMLElement>(`[data-queue-index="${index + 1}"]`)
    ?? list?.querySelector<HTMLElement>(`[data-queue-index="${index - 1}"]`);
  const height = row.getBoundingClientRect().height;
  if (!neighbour) return height;
  return Math.abs(neighbour.getBoundingClientRect().top - row.getBoundingClientRect().top) || height;
}

function findScrollContainer(element: HTMLElement): HTMLElement | undefined {
  let parent = element.parentElement;
  while (parent) {
    const overflowY = getComputedStyle(parent).overflowY;
    if (/(auto|scroll)/.test(overflowY) && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return undefined;
}

function autoScroll(container: HTMLElement | undefined, pointerY: number): void {
  if (!container) return;

  const bounds = container.getBoundingClientRect();
  const edgeSize = Math.min(72, bounds.height * 0.16);
  const upperDistance = pointerY - bounds.top;
  const lowerDistance = bounds.bottom - pointerY;

  if (upperDistance < edgeSize) {
    container.scrollTop -= scrollStep(upperDistance, edgeSize);
  } else if (lowerDistance < edgeSize) {
    container.scrollTop += scrollStep(lowerDistance, edgeSize);
  }
}

function scrollStep(distance: number, edgeSize: number): number {
  const strength = 1 - Math.max(0, distance) / edgeSize;
  return Math.round(4 + strength * 18);
}
