import { ArrowDown, ArrowUp, ListStart, Play, Scissors, Trash2, UserRound } from "lucide-react";
import { memo } from "react";
import { t } from "../../i18n";
import { ProfileAvatar } from "./ProfileAvatar";
import type { SharedQueueEdit, SharedQueueEntry } from "./listenTogetherTypes";
import { SharedTrackCover, SharedTrackDetails, trackDuration } from "./SharedTrackDisplay";

export interface QueueRowProps {
  entry: SharedQueueEntry;
  index: number;
  firstId: string;
  previousId: string | null;
  afterNextId: string | null;
  last: boolean;
  disabled: boolean;
  canPlay: boolean;
  /** The room only lets you edit your own songs, and this is someone else's. */
  locked: boolean;
  /** Inside a playlist block: remove this and every later song of the block. */
  trimmable: boolean;
  addedBy: string | undefined;
  avatar: string | null | undefined;
  onEdit: (edit: SharedQueueEdit) => void;
  onTrim: (id: string) => void;
  onDrag: (id: string | null) => void;
  onDrop: (beforeId: string) => void;
}

/**
 * One waiting song. Room status arrives often (ping, drift, playback), so a
 * row only renders again when something it shows or points to changed.
 */
export const SharedQueueRow = memo(function SharedQueueRow({ entry, index, firstId, previousId, afterNextId, last, disabled: busy, canPlay, locked, trimmable, addedBy, avatar, onEdit, onTrim, onDrag, onDrop }: QueueRowProps) {
  const disabled = busy || locked;
  return <li draggable={!disabled} data-locked={locked || undefined}
    onDragStart={() => onDrag(entry.id)} onDragEnd={() => onDrag(null)}
    onDragOver={(event) => { if (!disabled) event.preventDefault(); }}
    onDrop={(event) => { event.preventDefault(); onDrop(entry.id); }}>
    <span className="shared-queue-number">{index + 1}</span>
    <SharedTrackCover track={entry.track} />
    <div className="shared-queue-entry-copy"><SharedTrackDetails track={entry.track} />
      <span className="shared-track-attribution">
        {avatar ? <ProfileAvatar name={addedBy ?? ""} uri={avatar} /> : <UserRound size={13} aria-hidden="true" />}
        {addedBy ? t("listen.addedBy", { name: addedBy }) : t("listen.addedByUnknown")}
      </span>
    </div>
    <span className="shared-track-duration">{trackDuration(entry.track.durationMs)}</span>
    <div className="shared-queue-actions">
      {canPlay && <button className="icon-button" type="button" disabled={busy} title={t("listen.selection.now")} aria-label={t("listen.selection.nowName", { name: entry.track.title ?? t("listen.untitledTrack") })} onClick={() => onEdit({ type: "playQueued", id: entry.id })}><Play size={16} /></button>}
      {trimmable && <button className="icon-button" type="button" disabled={disabled} title={t("listen.queueTrim")} aria-label={t("listen.queueTrim")} onClick={() => onTrim(entry.id)}><Scissors size={16} /></button>}
      <button className="icon-button" type="button" disabled={disabled || index === 0} title={t("listen.queueToNext")} aria-label={t("listen.queueToNext")} onClick={() => onEdit({ type: "move", id: entry.id, beforeId: firstId })}><ListStart size={16} /></button>
      <button className="icon-button" type="button" disabled={disabled || !previousId} title={t("listen.queueUp")} aria-label={t("listen.queueUp")} onClick={() => previousId && onEdit({ type: "move", id: entry.id, beforeId: previousId })}><ArrowUp size={16} /></button>
      <button className="icon-button" type="button" disabled={disabled || last} title={t("listen.queueDown")} aria-label={t("listen.queueDown")} onClick={() => onEdit({ type: "move", id: entry.id, beforeId: afterNextId })}><ArrowDown size={16} /></button>
      <button className="icon-button" type="button" disabled={disabled} title={t("listen.queueRemove")} aria-label={t("listen.queueRemove")} onClick={() => onEdit({ type: "remove", id: entry.id })}><Trash2 size={16} /></button>
    </div>
  </li>;
}, (a, b) => a.entry.id === b.entry.id && a.entry.track.uri === b.entry.track.uri && a.index === b.index
  && a.firstId === b.firstId && a.previousId === b.previousId && a.afterNextId === b.afterNextId && a.last === b.last
  && a.disabled === b.disabled && a.canPlay === b.canPlay && a.locked === b.locked && a.trimmable === b.trimmable && a.addedBy === b.addedBy && a.avatar === b.avatar
  && a.onEdit === b.onEdit && a.onTrim === b.onTrim && a.onDrag === b.onDrag && a.onDrop === b.onDrop);
