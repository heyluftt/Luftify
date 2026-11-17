import { ChevronDown, Layers, ListStart, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { t } from "../../i18n";
import { formatListeningTime } from "../analytics/analyticsFormatting";
import type { SharedQueueGroup } from "./listenTogetherTypes";
import type { IndexedEntry } from "./queueSegments";
import { SharedTrackCover } from "./SharedTrackDisplay";

const COLLAPSED_ROWS = 3;

/** A playlist or album in the room queue: moved, removed or trimmed as one. */
export function SharedQueueGroupBlock({ group, items, first, disabled, locked, addedBy, onNext, onRemove, renderRow }: {
  group: SharedQueueGroup;
  items: IndexedEntry[];
  first: boolean;
  disabled: boolean;
  locked: boolean;
  addedBy: string | undefined;
  onNext: () => void;
  onRemove: () => void;
  renderRow: (item: IndexedEntry, trimmable: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(items.length <= COLLAPSED_ROWS + 1);
  const [confirm, setConfirm] = useState(false);
  const shown = open ? items : items.slice(0, COLLAPSED_ROWS);
  const totalMs = items.reduce((sum, { entry }) => sum + (entry.track.durationMs ?? 0), 0);
  const blocked = disabled || locked;
  return <li className="shared-queue-group-block">
    <div className="shared-queue-group-head">
      <SharedTrackCover track={items[0]!.entry.track} />
      <div className="shared-queue-group-copy">
        <span><Layers size={13} aria-hidden="true" />{t("listen.group.label")}</span>
        <strong title={group.name}>{group.name}</strong>
        <small>{[t("listen.queueSummary", { n: items.length, time: formatListeningTime(totalMs) }), addedBy && t("listen.addedBy", { name: addedBy })].filter(Boolean).join(" · ")}</small>
      </div>
      <div className="shared-queue-actions">
        <button className="icon-button" type="button" disabled={blocked || first} onClick={onNext}
          title={t("listen.group.next")} aria-label={t("listen.group.nextName", { name: group.name })}><ListStart size={16} /></button>
        <button className="icon-button" type="button" disabled={blocked} onClick={() => setConfirm(true)}
          title={t("listen.group.remove")} aria-label={t("listen.group.removeName", { name: group.name })}><Trash2 size={16} /></button>
      </div>
    </div>
    {confirm && <div className="shared-queue-confirm" role="group">
      <p>{t("listen.group.removeConfirm", { name: group.name, n: items.length })}</p>
      <button type="button" className="secondary-button" onClick={() => setConfirm(false)}>{t("listen.queueCancel")}</button>
      <button type="button" className="secondary-button danger" disabled={blocked} onClick={() => { onRemove(); setConfirm(false); }}>{t("listen.group.remove")}</button>
    </div>}
    <ol className="shared-queue-list">{shown.map((item, position) => renderRow(item, position > 0))}</ol>
    {items.length > COLLAPSED_ROWS + 1 && <button type="button" className="text-button shared-queue-group-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      <ChevronDown size={15} aria-hidden="true" />{t(open ? "listen.group.less" : "listen.group.more", { n: items.length - COLLAPSED_ROWS })}
    </button>}
  </li>;
}
