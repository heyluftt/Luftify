import { ArrowDown, ArrowUp, Clock3 } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PlaylistSortDirection } from "../features/library/playlistSorting";
import { t } from "../i18n";

interface TrackHeaderProps {
  showAlbum: boolean;
  showAddedAt: boolean;
  showAddedBy: boolean;
  showPlayCount: boolean;
  showDuration: boolean;
  showActions: boolean;
  addedAtSortDirection: PlaylistSortDirection | undefined;
  onAddedAtSort: (() => void) | undefined;
  rowStyle: CSSProperties | undefined;
}

/**
 * Column labels above a track list. At rest they sit on the page like the
 * rows; only while the header sticks to the top of the scroller does it get
 * a frosted background, so rows scrolling underneath stay unreadable.
 */
export function TrackHeader({
  showAlbum,
  showAddedAt,
  showAddedBy,
  showPlayCount,
  showDuration,
  showActions,
  addedAtSortDirection,
  onAddedAtSort,
  rowStyle,
}: TrackHeaderProps) {
  const stuck = useStuckHeader();

  return (
    <>
      <span ref={stuck.sentinel} className="track-header-sentinel" aria-hidden="true" />
      <div
        className={`track-row track-header${stuck.value ? " is-stuck" : ""}`}
        role="row"
        style={rowStyle}
      >
        <span>#</span>
        <span>{t("libraryUi.title")}</span>

        {showAlbum && <span className="track-album">{t("libraryUi.album")}</span>}

        {showAddedAt && (
          <button
            type="button"
            className="track-sort-header"
            aria-label={t("libraryUi.sortAdded")}
            onClick={onAddedAtSort}
          >
            {t("libraryUi.added")}
            {addedAtSortDirection === "asc" ? (
              <ArrowUp size={13} />
            ) : addedAtSortDirection === "desc" ? (
              <ArrowDown size={13} />
            ) : null}
          </button>
        )}

        {showAddedBy && <span className="track-contributor">{t("playlists.addedBy")}</span>}

        {showPlayCount && (
          <span className="play-count-header">{t("libraryUi.plays")}</span>
        )}

        {showDuration && (
          <Clock3 className="track-duration-header" size={14} aria-label={t("libraryUi.duration")} />
        )}

        {showActions && <span />}
      </div>
    </>
  );
}

/** True while the sentinel above the header has scrolled out of view. */
function useStuckHeader() {
  const sentinel = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(false);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const root = element.closest<HTMLElement>(".page-scroll, .queue-panel-scroll");
    const observer = new IntersectionObserver(
      ([entry]) => setValue(Boolean(entry && !entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0))),
      { root, threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { sentinel, value };
}
