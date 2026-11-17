import type { MediaItem, QueueItem, QueuePlacement } from "@luft/protocol-types";
import type { QueueDragPhase } from "./useQueueDragReorder";
import { GripVertical, LoaderCircle, MoreHorizontal, Play, Trash2 } from "lucide-react";
import type { CSSProperties, MouseEvent, PointerEvent, Ref } from "react";

import { AlbumArt } from "../../components/AlbumArt";
import { ArtistLinks } from "../../components/entity/ArtistLinks";
import { t } from "../../i18n";
import { isIncompleteQueueItem } from "./sanitizeQueue";

type DragHandlers = {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, index: number) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onLostPointerCapture: () => void;
};

export interface QueueTrackRowProps {
  entry: QueueItem;
  index: number;
  count: number;
  rowRef?: Ref<HTMLDivElement> | undefined;
  style?: CSSProperties | undefined;
  playOnRowClick: boolean;
  showActions: boolean;
  canReorder: boolean;
  reorderEnabled: boolean;
  removable: boolean;
  removalAmbiguous: boolean;
  removing: boolean;
  /** Position number to show; differs from `index` while a drag is under way. */
  order: number;
  /** Set on the row being dragged. */
  dragPhase?: QueueDragPhase | undefined;
  /** Steps aside (-1 up, 1 down) to open the gap for the dragged row. */
  shift: -1 | 0 | 1;
  drag: DragHandlers;
  onPlay: (uri: string) => void | Promise<void>;
  onRemove: (entry: QueueItem) => void;
  onReorder?: ((sourceIndex: number, anchorIndex: number, placement: QueuePlacement) => void) | undefined;
  onOpenActions: (item: MediaItem, removable: QueueItem | undefined, position: { x: number; y: number }) => void;
}

export function QueueTrackRow({
  entry, index, count, rowRef, style, playOnRowClick, showActions, canReorder, reorderEnabled,
  removable, removalAmbiguous, removing, order, dragPhase, shift, drag, onPlay, onRemove, onReorder,
  onOpenActions,
}: QueueTrackRowProps) {
  const item = entry.item;
  // Rows beyond the resolved window keep their place until their title arrives.
  const loading = isIncompleteQueueItem(item);
  const label = loading ? t("queue.loadingTrack") : item.title;
  const clickable = playOnRowClick && item.playable;

  return (
    <div
      ref={rowRef}
      style={style}
      data-index={index}
      data-queue-index={index}
      className={[
        "queue-track-row",
        clickable ? "is-clickable" : "",
        loading ? "is-loading" : "",
        removing ? "is-removing" : "",
        dragPhase ? `is-${dragPhase}` : "",
        shift < 0 ? "is-shift-up" : shift > 0 ? "is-shift-down" : "",
      ].filter(Boolean).join(" ")}
      role="listitem"
      aria-busy={loading || undefined}
      title={clickable && !loading ? t("queue.playTrack", { title: item.title }) : undefined}
      onClick={(event) => {
        if (!clickable || isInteractiveTarget(event.target)) return;
        void onPlay(item.uri);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenActions(item, removable ? entry : undefined, { x: event.clientX, y: event.clientY });
      }}
    >
      <div className="queue-track-leading">
        <span className="queue-track-order" aria-hidden="true">{order + 1}</span>
        <button
          type="button"
          className="queue-track-play"
          aria-label={t("queue.playTrack", { title: label })}
          disabled={!item.playable}
          onClick={() => void onPlay(item.uri)}
        >
          <Play size={15} fill="currentColor" />
        </button>
      </div>

      <div className="queue-track-main">
        <AlbumArt title={item.title} size="tiny" image={item.coverUri} priority={index < 16} />
        {loading ? (
          <span className="queue-track-copy queue-track-skeleton" aria-label={label}>
            <span />
            <span />
          </span>
        ) : (
          <span className="queue-track-copy">
            <strong className="queue-track-title" title={item.title}>{item.title}</strong>
            <ArtistLinks className="queue-track-artists" creators={item.creators} />
          </span>
        )}
      </div>

      {showActions && (
        <div
          className="queue-track-actions"
          title={removalAmbiguous ? t("queue.removeAmbiguous") : undefined}
        >
          {canReorder && (
            <button
              type="button"
              className="queue-track-action queue-track-drag-handle"
              aria-label={t("queue.moveTrack", { title: label })}
              title={reorderEnabled ? t("queue.moveHint") : t("queue.updating")}
              disabled={!reorderEnabled}
              onPointerDown={(event) => drag.onPointerDown(event, index)}
              onPointerMove={drag.onPointerMove}
              onPointerUp={drag.onPointerUp}
              onPointerCancel={drag.onPointerCancel}
              onLostPointerCapture={drag.onLostPointerCapture}
              onKeyDown={(event) => {
                if (!event.altKey || !reorderEnabled) return;
                if (event.key === "ArrowUp" && index > 0) {
                  event.preventDefault();
                  onReorder?.(index, index - 1, "before");
                } else if (event.key === "ArrowDown" && index < count - 1) {
                  event.preventDefault();
                  onReorder?.(index, index + 1, "after");
                }
              }}
            >
              <GripVertical size={17} />
            </button>
          )}

          {removable && (
            <button
              type="button"
              className="queue-track-action queue-track-remove"
              aria-label={t("queue.removeTrack", { title: label })}
              disabled={removing}
              onClick={() => onRemove(entry)}
            >
              {removing
                ? <LoaderCircle size={16} className="queue-track-spinner" />
                : <Trash2 size={16} />}
            </button>
          )}

          <button
            type="button"
            className="queue-track-action queue-track-more"
            aria-label={t("queue.moreActions", { title: label })}
            aria-haspopup="dialog"
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              onOpenActions(item, removable ? entry : undefined, {
                x: bounds.right - 8,
                y: bounds.bottom + 6,
              });
            }}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest("button, a, input, [role='button'], [data-no-row-play]"));
}
