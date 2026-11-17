import { t } from "../../i18n";
import type { MediaItem } from "@luft/protocol-types";
import { MoreHorizontal } from "lucide-react";
import {
  useState,
  type MouseEvent,
} from "react";

import { AlbumArt } from "../../components/AlbumArt";
import { ArtistLinks } from "../../components/entity/ArtistLinks";
import {
  TrackActionsMenu,
  type TrackActionsView,
} from "../../components/track-actions/TrackActionsMenu";

interface QueueCurrentItemProps {
  item: MediaItem;
  compact?: boolean;
}

interface OpenActions {
  position: { x: number; y: number };
  view: TrackActionsView;
}

export function QueueCurrentItem({
  item,
  compact = false,
}: QueueCurrentItemProps) {
  const [openActions, setOpenActions] =
    useState<OpenActions>();
  const openAtButton = (
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setOpenActions({
      position: {
        x: bounds.right - 8,
        y: bounds.bottom + 6,
      },
      view: "actions",
    });
  };

  return (
    <>
      <article
        className={[
          "queue-current",
          compact ? "queue-panel-current" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpenActions({
            position: {
              x: event.clientX,
              y: event.clientY,
            },
            view: "actions",
          });
        }}
      >
        <div className="queue-current-cover">
          <AlbumArt
            title={item.title}
            size="tiny"
            image={item.coverUri}
            priority
          />
        </div>

        <div className="queue-current-copy">
          <span className="queue-current-label">{t("shell.nowPlaying")}</span>
          <strong
            className="queue-current-title"
            title={item.title}
          >
            {item.title}
          </strong>
          <ArtistLinks
            className="queue-current-artist"
            creators={item.creators}
          />
        </div>

        <button
          type="button"
          className="queue-row-play"
          aria-label={t("queue.moreActions", { title: item.title })}
          aria-haspopup="dialog"
          onClick={openAtButton}
        >
          <MoreHorizontal size={18} />
        </button>
      </article>

      {openActions && (
        <TrackActionsMenu
          track={item}
          position={openActions.position}
          initialView={openActions.view}
          canQueue={false}
          saved={false}
          onSavedChange={undefined}
          onClose={() => setOpenActions(undefined)}
        />
      )}
    </>
  );
}
