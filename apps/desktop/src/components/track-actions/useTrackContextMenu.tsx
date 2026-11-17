import type { MediaItem } from "@luft/protocol-types";
import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import { TrackActionsMenu } from "./TrackActionsMenu";

interface TrackContextMenuOptions {
  track: MediaItem | undefined;
  canQueue: boolean;
  saved: boolean;
  onSavedChange?: (uri: string, saved: boolean) => void;
}

interface MenuPosition {
  x: number;
  y: number;
}

interface TrackContextMenu {
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  menu: ReactNode;
}

export function useTrackContextMenu({
  track,
  canQueue,
  saved,
  onSavedChange,
}: TrackContextMenuOptions): TrackContextMenu {
  const [position, setPosition] = useState<MenuPosition>();
  const trackUri = track?.uri;
  const close = useCallback(() => setPosition(undefined), []);

  useEffect(() => {
    close();
  }, [close, trackUri]);

  const onContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!track) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setPosition({
        x: event.clientX,
        y: event.clientY,
      });
    },
    [track],
  );

  return {
    onContextMenu,
    menu:
      track && position ? (
        <TrackActionsMenu
          key={`${track.uri}:${position.x}:${position.y}`}
          track={track}
          position={position}
          initialView="actions"
          canQueue={canQueue}
          saved={saved}
          onSavedChange={onSavedChange}
          onClose={close}
        />
      ) : null,
  };
}
