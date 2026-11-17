import { useState } from "react";
import { t } from "../../i18n";
import type { ListenTogetherStatus, SharedTrack } from "./listenTogetherTypes";
import { SharedQueueLibrary } from "./SharedQueueLibrary";
import { SharedQueueSearch } from "./SharedQueueSearch";
import { roomAddFeedback, useRoomQueueAdd, type RoomAddSource } from "./useRoomQueueAdd";
import { ROOM_QUEUE_LIMIT } from "./roomQueueBatch";

type Source = "search" | "playlists";

/** Where new songs come from: a search, or your own playlists. */
export function SharedQueueSources({ status, disabled, onAdd, onPlay }: { status: ListenTogetherStatus; disabled: boolean; onAdd: (track: SharedTrack) => void; onPlay: (track: SharedTrack) => void }) {
  const [source, setSource] = useState<Source>("search");
  const { mutation } = useRoomQueueAdd();
  const busy = disabled || mutation.isPending || !status.roomId;
  const full = (status.queue?.items.length ?? 0) >= ROOM_QUEUE_LIMIT;
  const canPlay = status.hostConnected && (status.role === "host" || status.canControl === true);
  const addMany = (from: RoomAddSource, next: boolean) => mutation.mutate({ source: from, next });
  const feedback = roomAddFeedback(mutation);
  return <div className="shared-queue-sources">
    <div className="shared-queue-tabs" role="tablist" aria-label={t("listen.sources.label")}>
      {(["search", "playlists"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={source === key}
        onClick={() => setSource(key)}>{t(key === "search" ? "listen.sources.search" : "listen.sources.playlists")}</button>)}
    </div>
    {feedback && <p className="room-add-status" role="status" data-error={mutation.isError || undefined}>{feedback}</p>}
    {source === "search"
      ? <SharedQueueSearch disabled={busy} canAdd={!full} canPlay={canPlay} onPlay={onPlay} onAdd={onAdd} onAddMany={addMany} />
      : <SharedQueueLibrary disabled={busy || full} onAddMany={addMany} />}
  </div>;
}
