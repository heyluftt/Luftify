import { t, appLanguage } from "../i18n";
import { useRoomSelectionIntent, type RoomSelectionIntent } from "../features/listen-together/roomSelectionIntent";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MediaItem } from "@luft/protocol-types";
import {
  Heart,
  ListPlus,
  MoreHorizontal,
  Play,
  Plus,
} from "lucide-react";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  formatAddedAt,
  type PlaylistSortDirection,
} from "../features/library/playlistSorting";
import { formatTime } from "../features/playback/PlayerBar";
import { useNowPlayingListNavigationEnabled } from "../features/playback/useNowPlayingListPreference";
import { usePlayerStore } from "../stores/playerStore";
import { AlbumArt } from "./AlbumArt";
import { ArtistLinks } from "./entity/ArtistLinks";
import { findFocusTrackIndex } from "./trackFocus";
import { useTrackFocus } from "./useTrackFocus";
import { TrackHeader } from "./TrackListHeader";
import {
  TrackActionsMenu,
  type TrackActionsView,
} from "./track-actions/TrackActionsMenu";

const TRACK_ROW_HEIGHT = 56;
const VIRTUAL_ROW_THRESHOLD = 80;
// Header row (38px) plus its gap to the first row (8px), see styles/ds/lists.css.
const TRACK_HEADER_HEIGHT = 46;
const PLAY_COUNT_FORMATTER = new Intl.NumberFormat(appLanguage(), {
  maximumFractionDigits: 0,
});

interface OpenTrackActions {
  track: MediaItem;
  index: number;
  position: { x: number; y: number };
  initialView: TrackActionsView;
}

type OpenTrackActionsHandler = (
  track: MediaItem,
  index: number,
  position: { x: number; y: number },
  initialView: TrackActionsView,
) => void;

interface TrackListProps {
  tracks: MediaItem[];
  onPlay: (uri: string, index: number) => void;
  onQueue?: (uri: string) => void;
  onSavedChange?: (uri: string, saved: boolean) => void;
  onRemoveFromPlaylist?:
    | ((track: MediaItem) => void | Promise<void>)
    | undefined;
  saved?: boolean | ((uri: string) => boolean);
  empty?: string;
  showAddedAt?: boolean;
  renderAddedBy?: ((track: MediaItem) => ReactNode) | undefined;
  addedAtSortDirection?: PlaylistSortDirection | undefined;
  onAddedAtSort?: () => void;
  compact?: boolean;
  showAlbum?: boolean;
  showDuration?: boolean;
  showActions?: boolean;
  focusRequest?: { trackUri: string; requestId: string } | undefined;
}

export function TrackList({
  tracks,
  onPlay,
  onQueue,
  onSavedChange,
  onRemoveFromPlaylist,
  saved = false,
  empty = t("libraryUi.noTracks"),
  showAddedAt = false,
  renderAddedBy,
  addedAtSortDirection,
  onAddedAtSort,
  compact = false,
  showAlbum = true,
  showDuration = true,
  showActions = true,
  focusRequest,
}: TrackListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollParent, setScrollParent] =
    useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [openActions, setOpenActions] =
    useState<OpenTrackActions>();
  const currentItem = usePlayerStore((state) => state.playback?.currentItem);
  const roomIntent = useRoomSelectionIntent();
  const nowPlayingNavigationEnabled =
    useNowPlayingListNavigationEnabled();
  // Stable, so memoised rows do not re-render when the list does (scrolling).
  const openTrackActions = useCallback<OpenTrackActionsHandler>((
    track,
    index,
    position,
    initialView,
  ) => {
    setOpenActions({ track, index, position, initialView });
  }, []);

  useLayoutEffect(() => {
    const listElement = listRef.current;

    if (!listElement) {
      setScrollParent(null);
      setScrollMargin(0);
      return;
    }

    const parent =
      listElement.closest<HTMLElement>(
        ".queue-v2-scroll, .page-scroll",
      ) ?? null;

    setScrollParent(parent);

    if (!parent) {
      setScrollMargin(0);
      return;
    }

    const parentTop = parent.getBoundingClientRect().top;
    const listTop = listElement.getBoundingClientRect().top;

    setScrollMargin(
      listTop -
        parentTop +
        parent.scrollTop +
        TRACK_HEADER_HEIGHT,
    );
  }, [tracks.length]);

  const longList = tracks.length >= VIRTUAL_ROW_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollParent,
    estimateSize: () => TRACK_ROW_HEIGHT,
    overscan: 12,
    scrollMargin,
    getItemKey: (index) => trackKey(tracks[index], index),
    // Short lists render every row and need no scroll listener at all.
    enabled: longList,
    // The scroller is the whole page. Without this the virtualizer scrolls
    // it to 0 on mount, which undid "Back" restoring the position.
    initialOffset: () => scrollParent?.scrollTop ?? 0,
  });

  const useVirtualRows = longList && scrollParent !== null;
  // Use the same identity resolution as the jump, including Spotify relinks.
  // Exact URI matches take priority over matching title/artist metadata.
  const currentTrackIndex = nowPlayingNavigationEnabled && currentItem
    ? findFocusTrackIndex(tracks, currentItem.uri, currentItem)
    : -1;
  const currentTrackUri = tracks[currentTrackIndex]?.uri;
  const focusIndex = nowPlayingNavigationEnabled && focusRequest
    ? findFocusTrackIndex(
        tracks,
        focusRequest.trackUri,
        currentItem?.uri === focusRequest.trackUri ? currentItem : undefined,
      )
    : -1;

  const flashIndex = useTrackFocus({
    listRef, scrollParent, scrollMargin, focusIndex, focusRequest,
    useVirtualRows, virtualizer,
  });

  const showPlayCount = tracks.some(
    (track) =>
      Number.isSafeInteger(track.playCount) &&
      (track.playCount ?? -1) >= 0,
  );

  const rowStyle = useMemo(() => createTrackGridStyle({
    compact,
    showAlbum,
    showAddedAt,
    showAddedBy: Boolean(renderAddedBy),
    showPlayCount,
    showDuration,
    showActions,
  }), [compact, showAlbum, showAddedAt, renderAddedBy, showPlayCount, showDuration, showActions]);

  const className = [
    "track-list",
    showAddedAt ? "with-added-date" : "",
    renderAddedBy ? "with-contributors" : "",
    compact ? "track-list-compact" : "",
    !showAlbum ? "without-album" : "",
    showPlayCount ? "with-play-count" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // After every hook: an empty list renders no rows.
  if (tracks.length === 0) {
    return <div className="empty-inline">{empty}</div>;
  }

  return (
    <>
      <div
        ref={listRef}
        className={className}
        role="table"
        aria-label={t("libraryUi.trackList")}
      >
        <TrackHeader
          showAlbum={showAlbum}
          showAddedAt={showAddedAt}
          showAddedBy={Boolean(renderAddedBy)}
          showPlayCount={showPlayCount}
          showDuration={showDuration}
          showActions={showActions}
          addedAtSortDirection={addedAtSortDirection}
          onAddedAtSort={onAddedAtSort}
          rowStyle={rowStyle}
        />

        {useVirtualRows ? (
          <div
            className="virtual-track-rows"
            style={{
              height: virtualizer.getTotalSize(),
            }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const track = tracks[item.index];

              if (!track) {
                return null;
              }

              return (
                <div
                  className="virtual-track-row"
                  key={item.key}
                  style={{
                    transform: `translateY(${
                      item.start - scrollMargin
                    }px)`,
                  }}
                >
                  <TrackRow
                    track={track}
                    index={item.index}
                    onPlay={onPlay}
                    roomIntent={roomIntent}
                    onSavedChange={onSavedChange}
                    onOpenActions={openTrackActions}
                    saved={saved}
                    showAlbum={showAlbum}
                    showAddedAt={showAddedAt}
                    renderAddedBy={renderAddedBy}
                    showPlayCount={showPlayCount}
                    showDuration={showDuration}
                    showActions={showActions}
                    isCurrent={nowPlayingNavigationEnabled && track.uri === currentTrackUri}
                    isFocused={flashIndex === item.index}
                    rowStyle={rowStyle}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          tracks.map((track, index) => (
            <TrackRow
              key={trackKey(track, index)}
              track={track}
              index={index}
              onPlay={onPlay}
              roomIntent={roomIntent}
              onSavedChange={onSavedChange}
              onOpenActions={openTrackActions}
              saved={saved}
              showAlbum={showAlbum}
              showAddedAt={showAddedAt}
              renderAddedBy={renderAddedBy}
              showPlayCount={showPlayCount}
              showDuration={showDuration}
              showActions={showActions}
              isCurrent={nowPlayingNavigationEnabled && track.uri === currentTrackUri}
              isFocused={flashIndex === index}
              rowStyle={rowStyle}
            />
          ))
        )}
      </div>

      {openActions && (
        <TrackActionsMenu
          key={`${openActions.track.uri}:${openActions.index}:${openActions.initialView}`}
          track={openActions.track}
          position={openActions.position}
          initialView={openActions.initialView}
          canQueue={Boolean(onQueue)}
          saved={
            typeof saved === "function"
              ? saved(openActions.track.uri)
              : Boolean(saved)
          }
          onSavedChange={onSavedChange}
          onRemoveFromPlaylist={
            onRemoveFromPlaylist
              ? () => onRemoveFromPlaylist(openActions.track)
              : undefined
          }
          onClose={() => setOpenActions(undefined)}
        />
      )}
    </>
  );
}

interface TrackRowProps {
  track: MediaItem;
  index: number;
  onPlay: (uri: string, index: number) => void;
  roomIntent: RoomSelectionIntent;
  onSavedChange:
    | ((uri: string, saved: boolean) => void)
    | undefined;
  onOpenActions: OpenTrackActionsHandler;
  saved: boolean | ((uri: string) => boolean);
  showAlbum: boolean;
  showAddedAt: boolean;
  renderAddedBy: ((track: MediaItem) => ReactNode) | undefined;
  showPlayCount: boolean;
  showDuration: boolean;
  showActions: boolean;
  isCurrent: boolean;
  /** Briefly marks the row a "From: playlist" jump landed on. */
  isFocused: boolean;
  rowStyle: CSSProperties | undefined;
}

const TrackRow = memo(function TrackRow({
  track,
  index,
  onPlay,
  roomIntent,
  onSavedChange,
  onOpenActions,
  saved,
  showAlbum,
  showAddedAt,
  renderAddedBy,
  showPlayCount,
  showDuration,
  showActions,
  isCurrent,
  isFocused,
  rowStyle,
}: TrackRowProps) {
  const trackSaved =
    typeof saved === "function"
      ? saved(track.uri)
      : Boolean(saved);

  // Only an explicit "not playable" from Spotify marks a row unavailable.
  const unavailable = track.playable === false;
  const rowClassName = [
    "track-row",
    isCurrent ? "is-current-track" : "",
    isFocused ? "is-focus-flash" : "",
    unavailable ? "is-unavailable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={rowClassName}
      role="row"
      aria-current={isCurrent ? "true" : undefined}
      data-track-index={index}
      style={rowStyle}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenActions(
          track,
          index,
          { x: event.clientX, y: event.clientY },
          "actions",
        );
      }}
    >
      <button
        type="button"
        className="row-play"
        aria-label={t(roomIntent === "queue" ? "listen.selection.addName" : roomIntent === "now" ? "listen.selection.nowName" : "libraryUi.play", { name: track.title })}
        disabled={unavailable || roomIntent === "offline"}
        title={unavailable ? t("libraryUi.unavailable") : roomIntent === "now" ? t("listen.selection.keepQueue") : roomIntent === "queue" ? t("listen.selection.guestHint") : undefined}
        onClick={() => onPlay(track.uri, index)}
      >
        <span>{index + 1}</span>
        {roomIntent === "queue" ? <ListPlus size={14} /> : <Play size={14} fill="currentColor" />}
      </button>

      <div className="track-main">
        <AlbumArt
          title={track.title}
          size="tiny"
          image={track.coverUri}
        />

        <span className="track-main-copy">
          <strong title={track.title}>
            {track.explicit && (
              <abbr className="track-explicit" title={t("libraryUi.explicit")}>E</abbr>
            )}
            {track.title}
          </strong>

          <ArtistLinks creators={track.creators} />
        </span>
      </div>

      {showAlbum && (
        <span
          className="muted-cell track-album"
          title={track.albumName ?? undefined}
        >
          {track.albumName ?? "—"}
        </span>
      )}

      {showAddedAt && (
        <time
          className="added-date"
          dateTime={track.addedAt ?? undefined}
        >
          {formatAddedAt(track.addedAt)}
        </time>
      )}

      {renderAddedBy && <span className="track-contributor">{renderAddedBy(track)}</span>}

      {showPlayCount && (
        <span
          className="play-count-cell"
          title={
            track.playCount !== undefined
              ? t(track.playCount === 1 ? "libraryUi.playCountOne" : "libraryUi.playCount", { count: formatSpotifyPlayCount(track.playCount) })
              : undefined
          }
        >
          {track.playCount !== undefined
            ? formatSpotifyPlayCount(track.playCount)
            : "—"}
        </span>
      )}

      {showDuration && (
        <time className="track-duration-cell">
          {track.durationMs !== undefined
            ? formatTime(track.durationMs)
            : "—"}
        </time>
      )}

      {showActions && (
        <div className="row-actions">
          <button
            type="button"
            aria-label={t("libraryUi.addPlaylist")}
            onClick={(event) =>
              openMenuFromButton(
                event,
                track,
                index,
                "playlists",
                onOpenActions,
              )
            }
          >
            <Plus size={16} />
          </button>

          {onSavedChange ? (
            <button
              type="button"
              aria-label={
                trackSaved
                  ? t("libraryUi.unlike")
                  : t("libraryUi.like")
              }
              onClick={() =>
                onSavedChange(track.uri, !trackSaved)
              }
            >
              <Heart
                size={16}
                fill={trackSaved ? "currentColor" : "none"}
              />
            </button>
          ) : null}

          <button
            type="button"
            aria-label={t("libraryUi.more")}
            onClick={(event) =>
              openMenuFromButton(
                event,
                track,
                index,
                "actions",
                onOpenActions,
              )
            }
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
      )}
    </div>
  );
});

function openMenuFromButton(
  event: MouseEvent<HTMLButtonElement>,
  track: MediaItem,
  index: number,
  initialView: TrackActionsView,
  onOpenActions: OpenTrackActionsHandler,
) {
  event.stopPropagation();
  const bounds = event.currentTarget.getBoundingClientRect();

  onOpenActions(
    track,
    index,
    { x: bounds.right - 8, y: bounds.bottom + 6 },
    initialView,
  );
}

function createTrackGridStyle({
  compact,
  showAlbum,
  showAddedAt,
  showAddedBy = false,
  showPlayCount,
  showDuration,
  showActions,
}: {
  compact: boolean;
  showAlbum: boolean;
  showAddedAt: boolean;
  showAddedBy?: boolean;
  showPlayCount: boolean;
  showDuration: boolean;
  showActions: boolean;
}): CSSProperties {
  const columns = compact
    ? ["42px", "minmax(0, 1fr)"]
    : ["34px", "minmax(220px, 1.5fr)"];

  if (showAlbum) {
    columns.push(
      compact
        ? "minmax(90px, 0.65fr)"
        : "minmax(125px, 0.9fr)",
    );
  }

  if (showAddedAt) {
    columns.push("110px");
  }

  if (showAddedBy) columns.push("minmax(130px, 0.7fr)");

  if (showPlayCount) {
    columns.push(compact ? "92px" : "minmax(96px, 0.52fr)");
  }

  if (showDuration) {
    columns.push(compact ? "58px" : "66px");
  }

  if (showActions) {
    columns.push("100px");
  }

  return {
    gridTemplateColumns: columns.join(" "),
  };
}

export function formatSpotifyPlayCount(playCount: number): string {
  return PLAY_COUNT_FORMATTER.format(playCount);
}

function trackKey(
  track: MediaItem | undefined,
  index: number,
): string {
  if (!track) {
    return String(index);
  }

  return `${track.uri}:${track.addedAt ?? "unknown"}:${index}`;
}

