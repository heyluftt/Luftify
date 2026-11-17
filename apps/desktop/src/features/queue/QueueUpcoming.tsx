import type { QueueItem, QueuePlacement } from "@luft/protocol-types";
import { LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { t } from "../../i18n";
import { usePlayerStore } from "../../stores/playerStore";
import { usePlaybackPlaylistContext } from "../playback/usePlaybackPlaylistContext";
import { QueueFeedback } from "./QueueFeedback";
import { QueueTrackList, queueRemovalKey } from "./QueueTrackList";
import { formatQueueCount, splitQueueSections } from "./queuePresentation";
import { createQueueReorderRequest } from "./queueReorder";
import { resetQueueWindow } from "./queueWindow";
import type { useQueueController } from "./useQueueController";

type QueueController = ReturnType<typeof useQueueController>;

/**
 * "Up next" for the queue page and the queue panel. With Libre the rows are
 * split like Spotify: manually queued titles first (the only part "Clear"
 * affects), then the rest of the playing context.
 */
export function QueueUpcoming({ controller, compact = false }: {
  controller: QueueController;
  compact?: boolean;
}) {
  const { queue, canClear, canRemove, canReorder, clear, remove, reorder, play, hydrating, connected } = controller;
  const contextUri = usePlayerStore((state) => state.playback?.contextUri);
  const playlist = usePlaybackPlaylistContext(contextUri, connected);
  const items = queue.data?.items ?? [];
  const sections = splitQueueSections(items);
  // Background refreshes only need the first page again.
  useEffect(() => resetQueueWindow, []);

  if (items.length === 0) {
    return hydrating
      ? <QueueFeedback kind="loading" compact={compact} />
      : <QueueFeedback kind="empty" compact={compact} />;
  }

  // Section lists index from 0; reorder requests address the whole queue.
  const reorderFrom = (offset: number) => (
    sourceIndex: number,
    anchorIndex: number,
    placement: QueuePlacement,
  ) => {
    if (!queue.data || reorder.isPending) return;
    const request = createQueueReorderRequest(
      queue.data.items,
      sourceIndex + offset,
      anchorIndex + offset,
      placement,
      queue.data.revision,
    );
    if (request) reorder.mutate(request);
  };

  // Only the last list reaches the end of the loaded window.
  const list = (rows: QueueItem[], offset: number, last: boolean) => (
    <QueueTrackList
      items={rows}
      canRemove={canRemove && !reorder.isPending}
      canReorder={canReorder}
      reorderPending={reorder.isPending}
      removingKey={remove.isPending && remove.variables ? queueRemovalKey(remove.variables) : null}
      onPlay={play}
      playOnRowClick={compact}
      onRemove={(entry) => remove.mutate(entry)}
      onReorder={reorderFrom(offset)}
      onEndReached={last ? controller.loadMore : undefined}
      onVisiblePlaceholders={controller.loadTitles}
      layoutKey={offset}
      compact={compact}
    />
  );

  const clearButton = canClear && (
    <button
      type="button"
      className="queue-refresh-button queue-clear-button"
      title={t("queue.clearHint")}
      disabled={clear.isPending || reorder.isPending}
      onClick={() => clear.mutate()}
    >
      {clear.isPending
        ? <LoaderCircle size={14} className="queue-track-spinner" />
        : <Trash2 size={14} />}
      <span>{t("queue.clear")}</span>
    </button>
  );

  const conflict = reorder.isError && (
    <div className="queue-reorder-error" role="alert">{t("queue.reorderConflict")}</div>
  );

  if (!sections) {
    return (
      <QueueSection compact={compact} title={t("queue.upNext")} count={controller.itemCountLabel}
        hint={canReorder && items.length > 1} action={clearButton}>
        {conflict}
        {list(items, 0, true)}
      </QueueSection>
    );
  }

  const contextTitle = playlist ? t("queue.nextFrom", { name: playlist.name }) : t("queue.upNext");
  return (
    <>
      {conflict}
      {sections.queued.length > 0 && (
        <QueueSection compact={compact} title={t("queue.queued")}
          count={formatQueueCount(sections.queued.length, sections.queued.length)}
          hint={canReorder && sections.queued.length > 1} action={clearButton}>
          {list(sections.queued, 0, sections.context.length === 0)}
        </QueueSection>
      )}
      {sections.context.length > 0 && (
        <QueueSection compact={compact} title={contextTitle}
          count={sections.queued.length === 0 ? controller.itemCountLabel : undefined}
          hint={canReorder && sections.context.length > 1 && sections.queued.length === 0}>
          {list(sections.context, sections.queued.length, true)}
        </QueueSection>
      )}
    </>
  );
}

function QueueSection({ compact, title, count, hint, action, children }: {
  compact: boolean;
  title: string;
  count?: string | undefined;
  hint?: boolean | undefined;
  action?: ReactNode;
  children: ReactNode;
}) {
  if (compact) {
    return (
      <>
        <div className="queue-panel-section-head">
          <span title={title}>{title}</span>
          <span className="queue-panel-section-meta">
            {count && <span>{count}</span>}
            {action}
          </span>
        </div>
        {children}
      </>
    );
  }
  return (
    <section className="queue-section">
      <div className="queue-section-head">
        <h2 title={title}>{title}</h2>
        <div className="queue-section-meta">
          {hint && <span className="queue-reorder-hint">{t("queue.dragHint")}</span>}
          {count && <span className="queue-count-badge">{count}</span>}
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}
