import { Shuffle, Trash2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useId, useRef, useState } from "react";
import { desktopApi } from "../../services/desktopApi";
import { t } from "../../i18n";
import { formatListeningTime } from "../analytics/analyticsFormatting";
import type { ListenTogetherStatus, SharedQueueEdit } from "./listenTogetherTypes";
import { ROOM_QUEUE_LIMIT } from "./roomQueueBatch";
import { SharedQueueNowNext } from "./SharedQueueNowNext";
import { SharedQueueGroupBlock } from "./SharedQueueGroupBlock";
import { SharedQueueRow } from "./SharedQueueRow";
import { blockTail, queueSegments, type IndexedEntry } from "./queueSegments";
import { SharedQueueSources } from "./SharedQueueSources";

export function SharedQueuePanel({ status }: { status: ListenTogetherStatus }) {
  const titleId = useId();
  const dragId = useRef<string | null>(null);
  const submitting = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const mutation = useMutation({
    mutationFn: ({ roomId, edit }: { roomId: string; edit: SharedQueueEdit }) => desktopApi.listenTogetherQueueEdit(roomId, edit),
    retry: false,
    onSettled: () => { submitting.current = false; },
  });
  const disabled = !status.roomId || status.connection !== "online" || mutation.isPending;
  const items = status.queue?.items ?? [];
  const steer = status.role === "host" || status.canControl === true;
  // Rows keep this identity across status updates; it reads the latest values.
  const latest = useRef({ disabled, roomId: status.roomId, items });
  latest.current = { disabled, roomId: status.roomId, items };
  const edit = useCallback((action: SharedQueueEdit) => {
    const { disabled: blocked, roomId } = latest.current;
    if (blocked || submitting.current || !roomId) return;
    submitting.current = true;
    mutation.mutate({ roomId, edit: action });
  }, [mutation.mutate]);
  const onDrag = useCallback((id: string | null) => { dragId.current = id; }, []);
  const onDrop = useCallback((beforeId: string) => {
    const id = dragId.current;
    dragId.current = null;
    if (id && id !== beforeId) edit({ type: "move", id, beforeId });
  }, [edit]);
  const onTrim = useCallback((id: string) => {
    const ids = blockTail(latest.current.items, id);
    if (ids.length) edit({ type: "removeMany", ids });
  }, [edit]);
  // With "own songs only", guests may not touch songs others added.
  const editsAll = status.role === "host" || status.queuePolicy !== "ownSongs";
  const locked = (addedById: string | undefined) => !editsAll && addedById !== status.youId;
  const totalMs = items.reduce((sum, entry) => sum + (entry.track.durationMs ?? 0), 0);
  const people = new Map(status.participants.map((person) => [person.id, person]));

  const row = ({ entry, index }: IndexedEntry, trimmable: boolean) => {
    const person = entry.addedById ? people.get(entry.addedById) : undefined;
    return <SharedQueueRow key={entry.id} entry={entry} index={index} firstId={items[0]!.id}
      previousId={items[index - 1]?.id ?? null} afterNextId={items[index + 2]?.id ?? null} last={index === items.length - 1}
      disabled={disabled} locked={locked(entry.addedById)} trimmable={trimmable}
      canPlay={steer && status.hostConnected}
      addedBy={person?.displayName || entry.addedByName || undefined} avatar={person?.avatarUri}
      onEdit={edit} onTrim={onTrim} onDrag={onDrag} onDrop={onDrop} />;
  };

  return <section className="listen-panel shared-queue" aria-labelledby={titleId}>
    <div className="listen-panel-heading"><h2 id={titleId}>{t("listen.queueTitle")}</h2><span className="listen-count">{items.length} / {ROOM_QUEUE_LIMIT}</span></div>
    <p>{t("listen.queueHint")}</p>
    <SharedQueueNowNext status={status} disabled={disabled} onRemove={(id) => edit({ type: "remove", id })} />
    <SharedQueueSources status={status} disabled={disabled} onAdd={(track) => edit({ type: "add", track })} onPlay={(track) => edit({ type: "playNow", track })} />
    <div className="shared-queue-feedback" aria-live="polite">
      {mutation.isPending ? t("listen.queueSaving") : mutation.isError ? queueError(mutation.error) : mutation.isSuccess ? t("listen.queueSaved") : null}
    </div>
    {!items.length ? <p className="shared-queue-empty">{t("listen.queueEmpty")}</p> : <>
      <div className="shared-queue-toolbar">
        <span>{t("listen.queueSummary", { n: items.length, time: formatListeningTime(totalMs) })}</span>
        {steer && <>
          <button type="button" className="text-button" disabled={disabled || items.length < 2} onClick={() => edit({ type: "shuffle" })}>
            <Shuffle size={15} aria-hidden="true" />{t("listen.queueShuffle")}
          </button>
          <button type="button" className="text-button" disabled={disabled} onClick={() => setConfirmClear(true)}>
            <Trash2 size={15} aria-hidden="true" />{t("listen.queueClear")}
          </button>
        </>}
      </div>
      {confirmClear && <div className="shared-queue-confirm" role="group">
        <p>{t("listen.queueClearConfirm", { n: items.length })}</p>
        <button type="button" className="secondary-button" onClick={() => setConfirmClear(false)}>{t("listen.queueCancel")}</button>
        <button type="button" className="secondary-button danger" disabled={disabled}
          onClick={() => { edit({ type: "clear" }); setConfirmClear(false); }}>{t("listen.queueClear")}</button>
      </div>}
      <ol className="shared-queue-list">
        {queueSegments(items).map((segment) => {
          if (segment.kind === "song") return row(segment.item, false);
          const ids = segment.items.map(({ entry }) => entry.id);
          const owner = segment.items[0]!.entry;
          return <SharedQueueGroupBlock key={`${segment.group.id}-${ids[0]}`} group={segment.group} items={segment.items}
            first={segment.items[0]!.index === 0} disabled={disabled} locked={segment.items.some(({ entry }) => locked(entry.addedById))}
            addedBy={(owner.addedById && people.get(owner.addedById)?.displayName) || owner.addedByName || undefined}
            onNext={() => edit({ type: "moveMany", ids, beforeId: items[0]!.id })}
            onRemove={() => edit({ type: "removeMany", ids })}
            renderRow={row} />;
        })}
      </ol>
    </>}
  </section>;
}

function queueError(error: unknown): string {
  const message = typeof error === "object" && error && "message" in error ? error.message : error;
  if (message === "listen.queueUncertain") return t("listen.queueUncertain");
  if (message === "listen.queueUnavailable") return t("listen.queueUnavailable");
  return t("listen.queueConflict");
}
