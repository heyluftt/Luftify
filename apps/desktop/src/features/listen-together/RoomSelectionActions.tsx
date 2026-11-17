import type { MediaItem } from "@luft/protocol-types";
import { ListPlus, ListStart, Play } from "lucide-react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import type { RunTrackAction } from "../../components/track-actions/trackActionTypes";
import { useListenRoomState } from "./guestLock";
import { ROOM_QUEUE_LIMIT, sharedTrack } from "./roomQueueBatch";

/** Room choices in the ordinary right-click menu, wherever a song was found. */
export function RoomSelectionActions({ track: item, runAction, pending }: { track: MediaItem; runAction: RunTrackAction; pending: boolean }) {
  const status = useListenRoomState(state => state.status);
  if (!status?.roomId) return null;
  const track = sharedTrack(item);
  const roomId = status.roomId;
  const disabled = pending || !track || status.connection !== "online";
  const full = (status.queue?.items.length ?? 0) >= ROOM_QUEUE_LIMIT;
  const steer = status.role === "host" || status.canControl === true;
  return <>
    {steer && <button type="button" disabled={disabled || !status.hostConnected} title={t("listen.selection.keepQueue")}
      onClick={() => track && void runAction("room-now", () => desktopApi.listenTogetherQueueEdit(roomId, { type: "playNow", track }), t("listen.selection.started"))}>
      <Play size={16} />{t("listen.selection.nowRoom")}
    </button>}
    <button type="button" disabled={disabled || full}
      onClick={() => track && void runAction("room-next", () => desktopApi.listenTogetherQueueEdit(roomId, { type: "addMany", tracks: [track], next: true }), t("listen.selection.nextSaved"))}>
      <ListStart size={16} />{t("listen.room.addNext")}
    </button>
    <button type="button" disabled={disabled || full}
      onClick={() => track && void runAction("room-end", () => desktopApi.listenTogetherQueueEdit(roomId, { type: "add", track }), t("listen.selection.endSaved"))}>
      <ListPlus size={16} />{t("listen.selection.endRoom")}
    </button>
  </>;
}
