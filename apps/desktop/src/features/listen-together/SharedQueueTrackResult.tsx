import type { MediaItem } from "@luft/protocol-types";
import { ListPlus, ListStart, Play } from "lucide-react";
import { t } from "../../i18n";
import type { SharedTrack } from "./listenTogetherTypes";
import { sharedTrack } from "./roomQueueBatch";
import { SharedTrackCover, SharedTrackDetails } from "./SharedTrackDisplay";
import type { RoomAddSource } from "./useRoomQueueAdd";

export function SharedQueueTrackResult({ item, disabled, canAdd, canPlay, onPlay, onAdd, onAddMany }: {
  item: MediaItem;
  disabled: boolean;
  canAdd: boolean;
  canPlay: boolean;
  onPlay: (track: SharedTrack) => void;
  onAdd: (track: SharedTrack) => void;
  onAddMany: (source: RoomAddSource, next: boolean) => void;
}) {
  const track = sharedTrack(item);
  return <li className="shared-search-song">
    <SharedTrackCover track={track ?? { provider: "spotify", uri: item.uri }} />
    <SharedTrackDetails track={track ?? { provider: "spotify", uri: item.uri, title: item.title }} />
    <div className="shared-search-song-actions">
      {canPlay && <button type="button" className="secondary-button" disabled={disabled || !track}
        title={t("listen.selection.keepQueue")} onClick={() => track && onPlay(track)}>
        <Play size={15} aria-hidden="true" />{t("listen.selection.now")}
      </button>}
      <button type="button" className="icon-button" disabled={disabled || !canAdd || !track} onClick={() => onAddMany({ tracks: [item] }, true)}
        title={t("listen.queueNextOne")} aria-label={t("listen.queueNextOne")}><ListStart size={16} aria-hidden="true" /></button>
      <button type="button" className={canPlay ? "icon-button" : "secondary-button"} disabled={disabled || !canAdd || !track} onClick={() => track && onAdd(track)}
        title={t("listen.selection.end")} aria-label={t("listen.selection.end")}>
        <ListPlus size={16} aria-hidden="true" />{!canPlay && t("listen.selection.end")}
      </button>
    </div>
  </li>;
}
