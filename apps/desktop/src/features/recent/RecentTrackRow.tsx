import type { MediaItem } from "@luft/protocol-types";
import { MoreHorizontal, Play } from "lucide-react";
import type { MouseEvent } from "react";

import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import type { RecentEntry } from "./recentTracks";

export function RecentTrackRow({
  entry,
  time,
  current,
  playing,
  onPlay,
  onOpenActions,
}: {
  entry: RecentEntry;
  time: string;
  current: boolean;
  playing: boolean;
  onPlay: () => void;
  onOpenActions: (item: MediaItem, position: { x: number; y: number }) => void;
}) {
  const { item, plays } = entry;
  const artists = item.creators.map((creator) => creator.name).join(" · ");
  return (
    <div
      className={`recent-track${current ? " is-current" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenActions(item, { x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        className="recent-track-main"
        aria-current={current ? "true" : undefined}
        aria-label={t("libraryUi.play", { name: item.title })}
        onClick={onPlay}
      >
        <span className="recent-track-art">
          <AlbumArt title={item.title} image={item.coverUri} size="tiny" />
          {current ? (
            <span className={`recent-live-bars${playing ? " is-playing" : ""}`} aria-hidden="true">
              <i /><i /><i />
            </span>
          ) : (
            <span className="recent-track-play" aria-hidden="true"><Play size={14} fill="currentColor" /></span>
          )}
        </span>
        <span className="recent-track-copy">
          <strong>{item.title}</strong>
          <small>{artists}</small>
        </span>
        <span className="recent-track-meta">
          <time dateTime={entry.playedAt.toISOString()}>{time}</time>
          {plays > 1 && <small title={t("recent.playsHint", { count: plays })}>{t("recent.plays", { count: plays })}</small>}
        </span>
      </button>
      <button
        type="button"
        className="recent-track-more"
        aria-label={t("recent.more", { title: item.title })}
        aria-haspopup="dialog"
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          onOpenActions(item, { x: bounds.right - 8, y: bounds.bottom + 6 });
        }}
      >
        <MoreHorizontal size={17} />
      </button>
    </div>
  );
}
