import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EntitySummary, MediaItem, PlaylistDetails } from "@luft/protocol-types";
import {
  Check,
  Disc3,
  Heart,
  ListMusic,
  ListPlus,
  LoaderCircle,
  MicVocal,
  Share2,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { artistDestination, ArtistLinks } from "../entity/ArtistLinks";
import { albumDestination } from "../../features/entities/mediaDestinations";
import { spotifyOpenUrl } from "../../features/entities/spotifyLinks";
import { QUEUE_QUERY_KEY } from "../../features/queue/queueQueries";
import { isLibrespotPlaybackReady } from "../../features/spotify/librespotCapabilities";
import { useOptionalCapability } from "../../features/spotify/useEngineCapability";
import { usePlaybackEngine } from "../../features/playback/usePlaybackEngine";
import { desktopApi } from "../../services/desktopApi";
import {
  matchesPlaylistSnapshotQuery,
  withAddedPlaylistTrack,
} from "../../features/entities/playlistMutations";
import { canonicalPlaylistUri } from "../../features/entities/playlistSnapshot";
import { t } from "../../i18n";
import { trackActionErrorMessage } from "./actionError";
import { AddToPlaylistPicker } from "./AddToPlaylistPicker";
import { playlistsContainingTrack } from "./playlistPicker";
import type { RunTrackAction, TrackMenuNavigate } from "./trackActionTypes";
import { TrackCreditsView } from "./TrackCreditsView";
import { TrackShareView } from "./TrackShareView";
import { useTrackMenuPosition } from "./useTrackMenuPosition";
import { RoomSelectionActions } from "../../features/listen-together/RoomSelectionActions";
import { useRoomSelectionIntent } from "../../features/listen-together/roomSelectionIntent";

export type TrackActionsView = "actions" | "playlists" | "share" | "credits";

interface TrackActionsMenuProps {
  track: MediaItem;
  position: { x: number; y: number };
  initialView: TrackActionsView;
  canQueue: boolean;
  saved: boolean;
  onSavedChange:
    | ((uri: string, saved: boolean) => void)
    | undefined;
  onRemoveFromPlaylist?: (() => void | Promise<void>) | undefined;
  onRemoveFromQueue?: (() => void | Promise<void>) | undefined;
  onClose: () => void;
}

type Feedback = {
  kind: "success" | "error";
  text: string;
};

export function TrackActionsMenu({
  track,
  position,
  initialView,
  canQueue,
  saved,
  onSavedChange,
  onRemoveFromPlaylist,
  onRemoveFromQueue,
  onClose,
}: TrackActionsMenuProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { engineReady } = usePlaybackEngine();
  const menuRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<TrackActionsView>(initialView);
  const [pendingAction, setPendingAction] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [duplicate, setDuplicate] = useState<EntitySummary>();

  const connected = engineReady;
  const like = useOptionalCapability("player.like");
  const queueAdd = useOptionalCapability("queue.add");
  const inRoom = useRoomSelectionIntent() !== "none";
  const playlistModify = useOptionalCapability("playlist.modify");
  const showLike = like.show;
  const showQueue = inRoom || (canQueue && queueAdd.show);
  const showPlaylistAdd = playlistModify.show;
  const album = albumDestination(track);
  const firstArtist = track.creators.find((creator) => creator.name.trim());
  const artist = firstArtist ? artistDestination(firstArtist) : undefined;
  const webUrl = spotifyOpenUrl(track.uri);

  const menuStyle = useTrackMenuPosition(menuRef, position);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Close only the menu, not the panel or dialog it was opened from.
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  const runAction: RunTrackAction = async (key, action, success) => {
    setPendingAction(key);
    setFeedback(undefined);

    try {
      await action();
      if (key === "remove-playlist" || key === "remove-queue") {
        onClose();
        return;
      }
      setFeedback({ kind: "success", text: success });
    } catch (error: unknown) {
      setFeedback({
        kind: "error",
        text: trackActionErrorMessage(error),
      });
    } finally {
      setPendingAction(undefined);
    }
  };

  const addToPlaylist = async (playlist: EntitySummary, confirmed = false) => {
    // Spotify adds a second copy silently; ask first when the cache knows it.
    if (!confirmed && playlistsContainingTrack(queryClient, track.uri).has(canonicalPlaylistUri(playlist.uri))) {
      setFeedback(undefined);
      setDuplicate(playlist);
      return;
    }
    setDuplicate(undefined);
    await runAction(
      playlist.uri,
      async () => {
        await desktopApi.addTrackToPlaylist(playlist.uri, track.uri);
        patchPlaylistSnapshots(queryClient, playlist.uri, track);
        await queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "playlist-snapshot"
            && matchesPlaylistSnapshotQuery(query.queryKey, playlist.uri),
        });
      },
      t("playlistPicker.added", { name: playlist.name }),
    );
  };

  const go: TrackMenuNavigate = (path, summary) => {
    if (summary) {
      navigate(path, { state: summary });
    } else {
      navigate(path);
    }
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="track-actions-menu"
      data-view={view}
      style={menuStyle}
      role="dialog"
      aria-label={t("trackActions.label", { title: track.title })}
    >
      <header className="track-actions-menu-header">
        <span>
          <strong>{track.title}</strong>
          <ArtistLinks
            className="track-actions-menu-artists"
            creators={track.creators}
          />
        </span>
        <button
          type="button"
          className="track-actions-close"
          aria-label={t("trackActions.close")}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      {view === "actions" && (
        <div className="track-actions-menu-list">
          {showQueue && (
            <ActionGroup>
              {inRoom ? <RoomSelectionActions track={track} runAction={runAction} pending={Boolean(pendingAction)} /> : <>
              <button
                type="button"
                disabled={!connected || !queueAdd.enabled}
                onClick={() =>
                  void runAction(
                    "queue",
                    async () => {
                      await desktopApi.addToQueue(track.uri, track);
                      await queryClient.invalidateQueries({
                        queryKey: QUEUE_QUERY_KEY,
                      });
                    },
                    t("trackActions.addedQueue"),
                  )
                }
              >
                <ListMusic size={16} />
                {t("trackActions.addQueue")}
              </button>
              </>}
            </ActionGroup>
          )}

          <ActionGroup>
            {showLike && (
              <button
                type="button"
                disabled={!connected || !like.enabled || pendingAction === "saved"}
                onClick={() =>
                  void runAction(
                    "saved",
                    () =>
                      onSavedChange
                        ? onSavedChange(track.uri, !saved)
                        : desktopApi.setTrackSaved(track.uri, !saved),
                    t(saved ? "trackActions.unliked" : "trackActions.liked"),
                  )
                }
              >
                <Heart size={16} fill={saved ? "currentColor" : "none"} />
                {t(saved ? "trackActions.unlike" : "trackActions.like")}
              </button>
            )}
            {showPlaylistAdd && (
              <button
                type="button"
                disabled={!connected || !playlistModify.enabled}
                onClick={() => setView("playlists")}
              >
                <ListPlus size={16} />
                {t("trackActions.addPlaylist")}
              </button>
            )}
            {onRemoveFromPlaylist && (
              <button
                type="button"
                className="track-actions-danger"
                disabled={!connected || pendingAction === "remove-playlist"}
                onClick={() =>
                  void runAction(
                    "remove-playlist",
                    onRemoveFromPlaylist,
                    t("trackActions.removedPlaylist"),
                  )
                }
              >
                {pendingAction === "remove-playlist" ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                {t("trackActions.removePlaylist")}
              </button>
            )}
            {onRemoveFromQueue && (
              <button
                type="button"
                className="track-actions-danger"
                disabled={!connected || pendingAction === "remove-queue"}
                onClick={() =>
                  void runAction(
                    "remove-queue",
                    onRemoveFromQueue,
                    t("trackActions.removedQueue"),
                  )
                }
              >
                {pendingAction === "remove-queue" ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                {t("trackActions.removeQueue")}
              </button>
            )}
          </ActionGroup>

          <ActionGroup>
            {album && (
              <button
                type="button"
                onClick={() => go(album.path, album.summary)}
              >
                <Disc3 size={16} />
                {t("trackActions.album")}
              </button>
            )}
            {artist && (
              <button
                type="button"
                onClick={() => go(artist.path, artist.summary)}
              >
                <User size={16} />
                {t("trackActions.artist")}
              </button>
            )}
            <button type="button" onClick={() => go("/lyrics")}>
              <MicVocal size={16} />
              {t("trackActions.lyrics")}
            </button>
          </ActionGroup>

          <ActionGroup>
            <button type="button" onClick={() => setView("credits")}>
              <Users size={16} />
              {t("trackActions.credits")}
            </button>
            <button type="button" onClick={() => setView("share")}>
              <Share2 size={16} />
              {t("trackActions.share")}
            </button>
          </ActionGroup>
        </div>
      )}

      {view === "playlists" && (
        <AddToPlaylistPicker
          queryClient={queryClient}
          trackUri={track.uri}
          duplicate={duplicate}
          onConfirmDuplicate={(playlist) => void addToPlaylist(playlist, true)}
          onCancelDuplicate={() => setDuplicate(undefined)}
          verifiedOnly
          pendingPlaylistUri={pendingAction}
          onBack={() => { setDuplicate(undefined); setView("actions"); }}
          onSelect={(playlist) => void addToPlaylist(playlist)}
        />
      )}

      {view === "share" && (
        <TrackShareView
          track={track}
          webUrl={webUrl}
          pendingAction={pendingAction}
          runAction={runAction}
          onBack={() => setView("actions")}
        />
      )}

      {view === "credits" && (
        <TrackCreditsView
          track={track}
          webUrl={webUrl}
          runAction={runAction}
          go={go}
          onBack={() => setView("actions")}
        />
      )}

      {feedback && (
        <p className={`track-actions-feedback ${feedback.kind}`}>
          {feedback.kind === "success" && <Check size={14} />}
          {feedback.text}
        </p>
      )}
    </div>,
    document.body,
  );
}

function ActionGroup({ children }: { children: ReactNode }) {
  return <div className="track-actions-group">{children}</div>;
}

function patchPlaylistSnapshots(
  queryClient: ReturnType<typeof useQueryClient>,
  playlistUri: string,
  track: MediaItem,
) {
  queryClient.setQueriesData<PlaylistDetails>(
    {
      predicate: (query) => matchesPlaylistSnapshotQuery(query.queryKey, playlistUri),
    },
    (current) => (current ? withAddedPlaylistTrack(current, track) : current),
  );
}
