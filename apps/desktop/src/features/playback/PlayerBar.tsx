import { AudioLines, ChevronDown, ChevronUp, History, Heart, ListMusic, MicVocal, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlbumArt } from "../../components/AlbumArt";
import { ArtistLinks } from "../../components/entity/ArtistLinks";
import { useTrackContextMenu } from "../../components/track-actions/useTrackContextMenu";
import { nextRepeatMode } from "../../stores/playerStore";
import { useUiStore } from "../../stores/uiStore";
import { usePlayback } from "./usePlayback";
import { AudioQuickSettings } from "../audio-control/AudioQuickSettings";
import { useAudioControlSettings } from "../audio-control/audioControl";
import { VolumeSlider } from "../audio-control/VolumeSlider";
import { albumDestination } from "../entities/mediaDestinations";
import { CurrentPlaylistLink } from "./CurrentPlaylistLink";
import { KeyWaitNotice, useKeyWaitSeconds } from "./KeyWaitNotice";
import { ListenAlongChip } from "../friends/listen-along/ListenAlongChip";
import { SmoothProgressTrack } from "./SmoothProgressTrack";
import { useOptionalCapability } from "../spotify/useEngineCapability";
import { usePlaybackClock } from "./usePlaybackClock";
import { isPlaybackClockLive, resolvePlaybackDurationMs } from "./playbackClock";
import { useSmoothProgress } from "./useSmoothProgress";
import { t } from "../../i18n";
import { formatTime } from "./formatTime";
import { useListenRoomState } from "../listen-together/guestLock";
import { useRoomTransport } from "../listen-together/roomTransport";
import { useCoverLanding } from "../motion/useCoverLanding";

export function PlayerBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { playback, command, isError, pending, seek, connected, connection, transportPending } = usePlayback();
  const room = useListenRoomState((state) => state.status);
  const roomSkipping = useListenRoomState((state) => state.skipping);
  const roomError = useListenRoomState((state) => state.error);
  const roomTransport = useRoomTransport();
  const inRoom = roomTransport.inRoom;
  const canRoomSkip = roomTransport.canSkip;
  const roomLockedTitle = t("listen.controlLocked");
  const settings = useAudioControlSettings();
  const [audioOpen, setAudioOpen] = useState(false);
  const [progressHover, setProgressHover] = useState(false);
  const audioPopover = useRef<HTMLDivElement>(null);
  const recentOpen = useUiStore((store) => store.recentOpen);
  const setRecentOpen = useUiStore((store) => store.setRecentOpen);
  const queueOpen = useUiStore((store) => store.queueOpen);
  const setQueueOpen = useUiStore((store) => store.setQueueOpen);
  const collapsed = useUiStore((store) => store.playerBarCollapsed);
  const toggleCollapsed = useUiStore((store) => store.togglePlayerBarCollapsed);
  const seekActive = seek.status.phase !== "idle";
  const like = useOptionalCapability("player.like");
  const shuffle = useOptionalCapability("player.shuffle");
  const repeat = useOptionalCapability("player.repeat");
  const keyWaitSeconds = useKeyWaitSeconds(playback?.clockReady === false);
  useEffect(() => {
    if (!audioOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!audioPopover.current?.contains(event.target as Node)) setAudioOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAudioOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeEscape);
    };
  }, [audioOpen]);
  useEffect(() => {
    if (collapsed) {
      setAudioOpen(false);
    }
  }, [collapsed]);
  useEffect(() => {
    if (queueOpen || recentOpen) setAudioOpen(false);
  }, [queueOpen, recentOpen]);
  // Keyboard navigation (palette, shortcuts) must not leave the popover floating over the next page.
  useEffect(() => setAudioOpen(false), [location.pathname]);
  const durationMs = resolvePlaybackDurationMs(playback?.durationMs, playback?.currentItem?.durationMs);
  const clock = usePlaybackClock({
    positionMs: playback?.positionMs ?? 0,
    durationMs,
    repeatMode: playback?.repeatMode ?? "off",
    playing: Boolean(playback?.isPlaying && playback.currentItem),
    suspended: seekActive || !connected || !isPlaybackClockLive(playback?.clockReady),
    ...(playback?.currentItem?.uri ? { trackKey: playback.currentItem.uri } : {}),
    // The bar shows mm:ss and animates its fill itself: one render a second.
    // The thumb shows under the pointer and moves with every tick.
    resolutionMs: progressHover ? 0 : 1_000,
  });
  const position = clock.positionMs;
  const item = playback?.currentItem;
  // Remounts cover, title and artists per song so they animate in; each
  // sibling needs its own key, or React keeps stale copies around.
  const songKey = item?.uri ?? "empty";
  const coverRef = useRef<HTMLButtonElement>(null);
  useCoverLanding(coverRef, songKey);
  useEffect(() => {
    if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
    console.debug("[Luftify]", {
      phase: "progress",
      track: item?.uri,
      positionMs: Math.round(position),
      durationMs,
      isPlaying: playback?.isPlaying ?? false,
      clockReady: playback?.clockReady,
      running: Boolean(playback?.isPlaying && connected && isPlaybackClockLive(playback.clockReady)),
    });
  }, [connected, durationMs, item?.uri, playback?.clockReady, playback?.isPlaying]);
  const run = (request: Parameters<typeof command>[0]) => command(request);
  const currentTrackActions = useTrackContextMenu({
    track: item,
    canQueue: connected,
    saved: playback?.isSaved ?? false,
    onSavedChange: (_uri, saved) => {
      if (playback && saved !== playback.isSaved) {
        void run({ command: "toggleLike" });
      }
    },
  });
  const collapseToggle = (
    <button
      type="button"
      className="playerbar-collapse-toggle"
      aria-expanded={!collapsed}
      aria-label={collapsed ? t("player.expand") : t("player.collapse")}
      title={collapsed ? t("player.expand") : t("player.collapse")}
      onClick={toggleCollapsed}
    >
      {collapsed
        ? <ChevronUp size={15} aria-hidden="true" />
        : <ChevronDown size={15} aria-hidden="true" />}
    </button>
  );
  if (!playback) {
    return (
      <footer
        className={collapsed ? "playerbar playerbar-empty is-collapsed" : "playerbar playerbar-empty"}
      >
        {collapseToggle}
        <span className="playerbar-empty-copy">
          {isError ? t("player.notConnected") : t("player.preparing")}
        </span>
      </footer>
    );
  }
  const previewSeek = (value: number) => {
    if (seek.status.phase === "idle") seek.begin();
    seek.preview(value);
  };
  const album = item ? albumDestination(item) : undefined;
  const openLyrics = () => {
    navigate("/lyrics");
  };
  const openAlbum = () => {
    if (!album) return;
    navigate(album.path, album.summary ? { state: album.summary } : undefined);
  };
  return (
    <footer
      className={collapsed ? "playerbar is-collapsed" : "playerbar"}
      aria-label={t("player.controls")}
    >
      {collapseToggle}
      <section
        className="track-identity"
        aria-hidden={collapsed}
        inert={collapsed}
        onContextMenu={currentTrackActions.onContextMenu}
      >
        <button
          key={`cover:${songKey}`}
          ref={coverRef}
          type="button"
          className="player-cover-link"
          aria-label={t("player.coverLyrics")}
          title={t("player.coverLyrics")}
          onClick={openLyrics}
        >
          <AlbumArt
            title={item?.title ?? t("player.noTrack")}
            size="small"
            image={item?.coverUri}
            priority
          />
        </button>
        <div className="track-copy">
          {album ? (
            <button key={`title:${songKey}`} type="button" className="track-title-link" onClick={openAlbum}>
              {item?.title ?? t("shell.noTitle")}
            </button>
          ) : (
            <strong key={`title:${songKey}`}>{item?.title ?? t("shell.noTitle")}</strong>
          )}
          <ArtistLinks
            key={`artists:${songKey}`}
            creators={item?.creators}
            fallback={t("player.unknownArtist")}
          />
          {roomError && <span role="alert">{t("listen.queueUncertain")}</span>}
          {keyWaitSeconds !== null ? (
            <KeyWaitNotice seconds={keyWaitSeconds} />
          ) : (
            <CurrentPlaylistLink
              connected={connected}
              contextUri={playback.contextUri}
              currentTrackUri={item?.uri}
            />
          )}
          <ListenAlongChip />
        </div>
        {like.show && (
          <button type="button" disabled={!connected || !like.enabled} className={playback.isSaved ? "icon-button player-like-button active" : "icon-button player-like-button"} aria-pressed={playback.isSaved} aria-label={playback.isSaved ? t("player.unlike") : t("player.like")} title={playback.isSaved ? t("player.liked") : t("player.like")} onClick={() => run({ command: "toggleLike" })}><Heart size={18} fill={playback.isSaved ? "currentColor" : "none"} /></button>
        )}
      </section>
      <section className="transport" aria-hidden={collapsed} inert={collapsed}>
        <div className="transport-buttons">
          {!inRoom && shuffle.show && (
            <button type="button" className={playback.shuffleEnabled ? "icon-button active player-command-button transport-toggle" : "icon-button player-command-button transport-toggle"} aria-label={t("player.shuffle")} title={playback.shuffleEnabled ? t("player.shuffleOn") : t("player.shuffleOff")} aria-pressed={playback.shuffleEnabled} aria-busy={pending.shuffle !== null} disabled={!connected || !shuffle.enabled || pending.shuffle !== null} onClick={() => run({ command: "setShuffle", enabled: !playback.shuffleEnabled })}><Shuffle size={17} /></button>
          )}
          <button type="button" disabled={inRoom ? !roomTransport.canControl : !connected} aria-busy={transportPending.count > 0 && transportPending.activeAction === "previous"} className="icon-button" aria-label={inRoom ? t("listen.restartTrack") : t("player.previous")} title={inRoom ? (roomTransport.canControl ? t("listen.restartTrack") : roomLockedTitle) : t("player.previous")} onClick={() => run({ command: "previous" })}><SkipBack size={20} fill="currentColor" /></button>
          <button type="button" disabled={inRoom ? !roomTransport.canControl : !connected} className="play-button" aria-label={playback.isPlaying ? t("player.pause") : t("player.play")} title={inRoom && !roomTransport.canControl ? roomLockedTitle : playback.isPlaying ? t("player.pause") : t("player.play")} onClick={() => run({ command: playback.isPlaying ? "pause" : "play" })}>{playback.isPlaying ? <Pause fill="currentColor" size={20} /> : <Play fill="currentColor" size={20} />}</button>
          <button type="button" disabled={inRoom ? !canRoomSkip : !connected} aria-busy={inRoom ? roomSkipping : transportPending.count > 0 && transportPending.activeAction === "next"} className="icon-button" aria-label={t("player.next")} title={inRoom && !canRoomSkip && roomTransport.inRoom ? roomLockedTitle : t("player.next")} onClick={() => run({ command: "next" })}><SkipForward size={20} fill="currentColor" /></button>
          {!inRoom && repeat.show && (
            <button type="button" className={playback.repeatMode !== "off" ? "icon-button active player-command-button transport-toggle" : "icon-button player-command-button transport-toggle"} data-repeat={playback.repeatMode} aria-label={repeatModeLabel(playback.repeatMode)} title={repeatModeLabel(playback.repeatMode)} aria-pressed={playback.repeatMode !== "off"} aria-busy={pending.repeat !== null} disabled={!connected || !repeat.enabled || pending.repeat !== null} onClick={() => run({ command: "setRepeat", repeatMode: nextRepeatMode(playback.repeatMode) })}>{playback.repeatMode === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}</button>
          )}
        </div>
        <div
          className="progress-row"
          onPointerEnter={() => setProgressHover(true)}
          onPointerLeave={() => setProgressHover(false)}
        >
          <time>{formatTime(position)}</time>
          <SmoothProgressTrack
            positionMs={position}
            durationMs={durationMs}
            running={playback.isPlaying && connected && !seekActive && isPlaybackClockLive(playback.clockReady)}
            {...(item?.uri ? { trackKey: item.uri } : {})}
          >
            <input
              aria-label={t("player.progress")}
              aria-busy={seek.status.phase === "confirming"}
              disabled={inRoom ? !roomTransport.canControl : !connected}
              type="range"
              min={0}
              max={Math.max(durationMs, 1)}
              value={position}
              onPointerDown={() => seek.begin()}
              onChange={(event) => previewSeek(Number(event.currentTarget.value))}
              onPointerUp={() => seek.commit()}
              onKeyUp={() => seek.commit()}
              onBlur={() => seek.commit()}
            />
          </SmoothProgressTrack>
          <time>{formatTime(durationMs)}</time>
        </div>
      </section>
      <section className="player-extras" aria-hidden={collapsed} inert={collapsed}>
        <button
          type="button"
          className={location.pathname === "/lyrics" || location.pathname === "/modules/lyrics" ? "icon-button active" : "icon-button"}
          aria-current={location.pathname === "/lyrics" || location.pathname === "/modules/lyrics" ? "page" : undefined}
          aria-label={t("player.lyrics")}
          onClick={() => navigate("/lyrics")}
        >
          <MicVocal size={18} />
        </button>
        <button
          type="button"
          className={recentOpen ? "icon-button active" : "icon-button"}
          aria-expanded={recentOpen}
          aria-controls="recent-panel"
          aria-haspopup="dialog"
          aria-label={t("recent.title")}
          title={t("recent.title")}
          onClick={() => setRecentOpen(!recentOpen)}
        >
          <History size={18} />
        </button>
        <button
          type="button"
          className={queueOpen || location.pathname === "/queue" ? "icon-button active" : "icon-button"}
          aria-current={queueOpen || location.pathname === "/queue" ? "page" : undefined}
          aria-label={queueOpen ? t("player.closeQueue") : t("player.openQueue")}
          title={queueOpen ? t("player.closeQueue") : t("player.openQueue")}
          aria-controls="queue-panel"
          aria-expanded={queueOpen}
          onClick={() => setQueueOpen(!queueOpen)}
        >
          <ListMusic size={18} />
        </button>
        <div className="player-audio-control" ref={audioPopover}>
          <button
            type="button"
            className={audioOpen || location.pathname === "/modules/audio-control" ? "icon-button active" : "icon-button"}
            aria-label={t("player.audio")}
            title={t("player.audio")}
            aria-expanded={audioOpen}
            aria-haspopup="dialog"
            aria-controls="audio-quick-settings"
            onClick={() => {
              const nextOpen = !audioOpen;
              if (nextOpen) { setQueueOpen(false); setRecentOpen(false); }
              setAudioOpen(nextOpen);
            }}
          >
            <AudioLines size={18} />
          </button>
          {audioOpen && (
            <AudioQuickSettings
              connected={connected}
              muted={playback.isMuted}
              onClose={() => setAudioOpen(false)}
              settings={settings}
              volume={playback.volume}
            />
          )}
        </div>
        <VolumeSlider settings={settings} showPercentage={settings.enabled && settings.showPercentage} />
        {!connected && <span className="player-connection-copy">{connection === "connecting" ? t("player.connecting") : t("player.reconnecting")}</span>}
        <span className={connected ? "connection-light" : "connection-light offline"} title={connected ? t("player.connected") : t("player.disconnected")} />
      </section>
      {collapsed && (
        <CollapsedPlayerSummary
          title={item?.title ?? t("player.noTrack")}
          artist={item?.creators.map((creator) => creator.name).join(", ") || t("player.unknownArtist")}
          playing={playback.isPlaying}
          positionMs={position}
          durationMs={durationMs}
          running={playback.isPlaying && connected && !seekActive && isPlaybackClockLive(playback.clockReady)}
          onExpand={toggleCollapsed}
          {...(item?.uri ? { trackKey: item.uri } : {})}
        />
      )}
      {currentTrackActions.menu}
    </footer>
  );
}

function CollapsedPlayerSummary({
  title,
  artist,
  playing,
  positionMs,
  durationMs,
  running,
  onExpand,
  trackKey,
}: {
  title: string;
  artist: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  running: boolean;
  onExpand: () => void;
  trackKey?: string;
}) {
  const bar = useRef<HTMLElement | null>(null);
  useSmoothProgress(bar, {
    positionMs,
    durationMs,
    running,
    ...(trackKey ? { trackKey } : {}),
  });

  return (
    <button
      type="button"
      className="playerbar-collapsed-summary"
      aria-label={t("player.expand")}
      title={t("player.expand")}
      onClick={onExpand}
    >
      <span className="playerbar-collapsed-progress-track" aria-hidden="true" />
      <span ref={bar} className="playerbar-collapsed-progress" aria-hidden="true" />
      <p className="playerbar-collapsed-track">
        <span
          className={playing ? "playerbar-collapsed-state is-playing" : "playerbar-collapsed-state"}
          aria-hidden="true"
        />
        <strong>{title}</strong>
        <small>{artist}</small>
      </p>
      <time>
        {formatTime(positionMs)}
        <span> / {formatTime(durationMs)}</span>
      </time>
    </button>
  );
}

export { formatTime } from "./formatTime";

function repeatModeLabel(mode: "off" | "all" | "one"): string {
  if (mode === "all") return t("player.repeatAll");
  if (mode === "one") return t("player.repeatOne");
  return t("player.repeatOff");
}
