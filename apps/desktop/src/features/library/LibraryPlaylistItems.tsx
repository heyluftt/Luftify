import type { EntitySummary } from "@luft/protocol-types";
import { Heart, Play } from "lucide-react";
import { AlbumArt } from "../../components/AlbumArt";
import { MediaTile } from "../../components/ui/MediaTile";
import { appLanguage, t } from "../../i18n";
import { formatTrackCount, playlistDetail } from "./libraryPresentation";

const addedFormatter = new Intl.DateTimeFormat(appLanguage(), {
  day: "numeric",
  month: "short",
  year: "numeric",
});

interface PlaylistItemProps {
  item: EntitySummary;
  usage?: string | undefined;
  onOpen: () => void;
  onPlay: () => void;
}

export function PlaylistCard({ item, usage, onOpen, onPlay }: PlaylistItemProps) {
  return (
    <MediaTile
      title={item.name}
      subtitle={usage ?? playlistDetail(item)}
      image={item.coverUri}
      openLabel={t("libraryUi.open", { name: item.name })}
      playLabel={t("libraryUi.play", { name: item.name })}
      onOpen={onOpen}
      onPlay={onPlay}
    />
  );
}

export function PlaylistRow({
  item,
  usage,
  showFolder,
  onOpen,
  onPlay,
}: PlaylistItemProps & { showFolder: boolean }) {
  const addedAt = item.library?.addedAt;
  return (
    <div className="library-playlist-row">
      <button
        type="button"
        className="library-row-open"
        aria-label={t("libraryUi.open", { name: item.name })}
        onClick={onOpen}
      >
        <AlbumArt title={item.name} image={item.coverUri} size="small" />
        <span className="library-row-title">
          <strong title={item.name}>{item.name}</strong>
          <small>{playlistDetail(item)}</small>
        </span>
        {showFolder && (
          <span className="library-row-cell" title={item.library?.folder}>
            {item.library?.folder ?? ""}
          </span>
        )}
        <span className="library-row-cell">
          {usage ?? t("libraryUi.neverPlayed")}
        </span>
        <span className="library-row-cell library-row-date">
          {addedAt ? addedFormatter.format(new Date(addedAt)) : ""}
        </span>
      </button>
      <PlayButton name={item.name} onPlay={onPlay} />
    </div>
  );
}

interface LikedProps {
  count: number | undefined;
  onOpen: () => void;
  onPlay: () => void;
}

export function LikedSongsCard({ count, onOpen, onPlay }: LikedProps) {
  const name = t("library.liked");
  return (
    <MediaTile
      title={name}
      subtitle={count === undefined ? t("search.kind.playlist") : formatTrackCount(count)}
      art={<span className="ds-liked-cover" aria-hidden="true"><Heart size={40} fill="currentColor" /></span>}
      openLabel={t("library.openLiked")}
      playLabel={t("libraryUi.play", { name })}
      onOpen={onOpen}
      onPlay={count !== 0 ? onPlay : undefined}
    />
  );
}

export function LikedSongsRow({
  count,
  showFolder,
  onOpen,
  onPlay,
}: LikedProps & { showFolder: boolean }) {
  const name = t("library.liked");
  return (
    <div className="library-playlist-row library-liked-row">
      <button
        type="button"
        className="library-row-open"
        aria-label={t("library.openLiked")}
        onClick={onOpen}
      >
        <span className="library-liked-art" aria-hidden="true">
          <Heart size={16} fill="currentColor" />
        </span>
        <span className="library-row-title">
          <strong>{name}</strong>
          <small>{count === undefined ? "" : formatTrackCount(count)}</small>
        </span>
        {showFolder && <span className="library-row-cell" />}
        <span className="library-row-cell" />
        <span className="library-row-cell library-row-date" />
      </button>
      {count !== 0 && <PlayButton name={name} onPlay={onPlay} />}
    </div>
  );
}

function PlayButton({ name, onPlay }: { name: string; onPlay: () => void }) {
  return (
    <button
      type="button"
      className="library-card-play"
      aria-label={t("libraryUi.play", { name })}
      onClick={onPlay}
    >
      <Play size={14} fill="currentColor" />
    </button>
  );
}
