import {
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

import { QueueCurrentItem } from "../features/queue/QueueCurrentItem";
import { QueueFeedback } from "../features/queue/QueueFeedback";
import { QueueUpcoming } from "../features/queue/QueueUpcoming";
import { useQueueController } from "../features/queue/useQueueController";
import { t } from "../i18n";
import { useListenTogether } from "../features/listen-together/useListenTogether";
import { SharedQueuePanel } from "../features/listen-together/SharedQueuePanel";

export function QueuePage() {
  const { query } = useListenTogether();
  if (query.data?.roomId) return <div className="page listen-together-page"><SharedQueuePanel key={query.data.roomId} status={query.data} /></div>;
  return <LocalQueuePage />;
}

function LocalQueuePage() {
  const [manualRefreshPending, setManualRefreshPending] =
    useState(false);
  const controller = useQueueController();
  const { connected, canRead, queue, reorder, itemCountLabel } = controller;
  const currentItem = queue.data?.currentItem;

  const refreshQueue = async () => {
    if (manualRefreshPending) {
      return;
    }

    setManualRefreshPending(true);
    try {
      await queue.refetch();
    } finally {
      setManualRefreshPending(false);
    }
  };

  const content = !connected ? (
    <QueueFeedback kind="connecting" />
  ) : !canRead ? (
    <QueueFeedback kind="unavailable" />
  ) : queue.isPending && !queue.data ? (
    <QueueFeedback kind="loading" />
  ) : queue.isError && !queue.data ? (
    <QueueFeedback
      kind="error"
      onRetry={() => void queue.refetch()}
    />
  ) : (
    <>
      {currentItem && (
        <section className="queue-section">
          <div className="queue-section-head">
            <h2>{t("queue.nowPlaying")}</h2>
          </div>
          <QueueCurrentItem item={currentItem} />
        </section>
      )}

      <QueueUpcoming controller={controller} />
    </>
  );

  return (
    <div className="page queue-page">
      <header className="queue-page-header">
        <div className="queue-page-heading">
          <h1>{t("queue.title")}</h1>
        </div>

        <div className="queue-header-actions">
          {connected && canRead && (
            <span className="queue-count-badge">
              {itemCountLabel}
            </span>
          )}

          <button
            type="button"
            className="queue-refresh-button"
            disabled={
              !connected
              || !canRead
              || manualRefreshPending
              || reorder.isPending
            }
            onClick={() => void refreshQueue()}
          >
            {manualRefreshPending ? (
              <LoaderCircle
                size={15}
                className="queue-track-spinner"
              />
            ) : (
              <RefreshCw size={15} />
            )}
            <span>{t("queue.refresh")}</span>
          </button>
        </div>
      </header>

      {content}
    </div>
  );
}
