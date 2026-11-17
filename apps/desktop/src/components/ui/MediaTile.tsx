import { Pause, Play } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { AlbumArt } from "../AlbumArt";

interface MediaTileProps {
  title: string;
  subtitle?: string | undefined;
  image?: string | undefined;
  /** Replaces the cover, e.g. the liked-songs gradient or a mosaic. */
  art?: ReactNode;
  round?: boolean;
  badge?: ReactNode;
  openLabel: string;
  playLabel?: string | undefined;
  playing?: boolean;
  style?: CSSProperties;
  onOpen: () => void;
  onPlay?: (() => void) | undefined;
}

/**
 * The one cover tile of the app: cover, title, one line of detail and a
 * play button that rises on hover. Open and play are separate buttons.
 */
export function MediaTile({
  title,
  subtitle,
  image,
  art,
  round = false,
  badge,
  openLabel,
  playLabel,
  playing = false,
  style,
  onOpen,
  onPlay,
}: MediaTileProps) {
  return (
    <article className={round ? "ds-tile is-round" : "ds-tile"} style={style}>
      <button type="button" className="ds-tile-open" aria-label={openLabel} onClick={onOpen}>
        <span className="ds-tile-art">
          {art ?? <AlbumArt title={title} image={image} size="medium" />}
          {badge && <span className="ds-tile-badge">{badge}</span>}
        </span>
        <span className="ds-tile-copy">
          <span className="ds-tile-title" title={title}>{title}</span>
          {subtitle && <span className="ds-tile-sub" title={subtitle}>{subtitle}</span>}
        </span>
      </button>
      {onPlay && (
        <button
          type="button"
          className={playing ? "ds-tile-play is-playing" : "ds-tile-play"}
          aria-label={playLabel ?? title}
          title={playLabel}
          onClick={onPlay}
        >
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
      )}
    </article>
  );
}

/** A wide tile: small cover left, title right (quick picks). */
export function RowTile({
  title,
  subtitle,
  image,
  art,
  openLabel,
  playLabel,
  playing = false,
  onOpen,
  onPlay,
}: Omit<MediaTileProps, "round" | "badge" | "style">) {
  return (
    <article className="ds-row-tile">
      <button type="button" className="ds-row-tile-open" aria-label={openLabel} onClick={onOpen}>
        {art ?? <AlbumArt title={title} image={image} size="small" />}
        <span className="ds-row-tile-copy">
          <strong title={title}>{title}</strong>
          {subtitle && <small title={subtitle}>{subtitle}</small>}
        </span>
      </button>
      {onPlay && (
        <button
          type="button"
          className={playing ? "ds-tile-play is-playing" : "ds-tile-play"}
          aria-label={playLabel ?? title}
          title={playLabel}
          onClick={onPlay}
        >
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
      )}
    </article>
  );
}
