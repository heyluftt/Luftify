import type { MediaItem } from "@luft/protocol-types";
import { ListPlus, ListStart } from "lucide-react";
import { t } from "../../i18n";
import { roomAddFeedback, useRoomQueueAdd } from "./useRoomQueueAdd";

/**
 * On playlist and album pages while in a room: the whole list goes into the
 * shared queue. `tracks` are used when complete, otherwise the list is loaded.
 */
export function AddToRoomButton({ uri, name, tracks, complete }: { uri: string; name: string; tracks: MediaItem[]; complete: boolean }) {
  const { inRoom, mutation } = useRoomQueueAdd();
  if (!inRoom) return null;
  const add = (next: boolean) => mutation.mutate({ source: complete ? { tracks, name } : { uri, name }, next });
  const feedback = roomAddFeedback(mutation);
  return <div className="room-add">
    <button type="button" className="secondary-button" disabled={mutation.isPending} onClick={() => add(false)}>
      <ListPlus size={16} aria-hidden="true" />{t("listen.room.add")}
    </button>
    <button type="button" className="icon-button" disabled={mutation.isPending} onClick={() => add(true)}
      title={t("listen.room.addNext")} aria-label={t("listen.room.addNext")}>
      <ListStart size={17} aria-hidden="true" />
    </button>
    {feedback && <span className="room-add-status" role="status" data-error={mutation.isError || undefined}>{feedback}</span>}
  </div>;
}
