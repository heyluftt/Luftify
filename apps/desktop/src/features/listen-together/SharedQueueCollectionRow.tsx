import type { EntitySummary } from "@luft/protocol-types";
import { ListPlus, ListStart } from "lucide-react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import type { RoomAddSource } from "./useRoomQueueAdd";

/** A playlist or album that goes into the room as a whole. */
export function SharedQueueCollectionRow({ entity, detail, disabled, onAddMany }: {
  entity: EntitySummary;
  detail?: string | undefined;
  disabled: boolean;
  onAddMany: (source: RoomAddSource, next: boolean) => void;
}) {
  return <li className="shared-queue-collection">
    <span className="shared-track-cover" aria-hidden="true"><AlbumArt title={entity.name} image={entity.coverUri} size="tiny" /></span>
    <div className="shared-queue-track"><strong title={entity.name}>{entity.name}</strong>
      {(detail ?? entity.subtitle) && <span className="shared-track-artists">{detail ?? entity.subtitle}</span>}</div>
    <button type="button" className="icon-button" disabled={disabled} onClick={() => onAddMany({ uri: entity.uri, name: entity.name }, true)}
      title={t("listen.queueNextAllName", { name: entity.name })} aria-label={t("listen.queueNextAllName", { name: entity.name })}>
      <ListStart size={16} aria-hidden="true" />
    </button>
    <button type="button" className="secondary-button" disabled={disabled} onClick={() => onAddMany({ uri: entity.uri, name: entity.name }, false)}
      aria-label={t("listen.queueAddAllName", { name: entity.name })}>
      <ListPlus size={16} aria-hidden="true" />{t("listen.queueAddAll")}
    </button>
  </li>;
}
