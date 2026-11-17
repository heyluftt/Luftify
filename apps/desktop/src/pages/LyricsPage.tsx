import { useEffect, useMemo } from "react";
import { useTrackContextMenu } from "../components/track-actions/useTrackContextMenu";
import { LyricsCoverView } from "../features/lyrics/LyricsCoverView";
import { CanvasRoom } from "../features/canvas-room/CanvasRoom";
import { useRoomLyricsPreference } from "../features/canvas-room/useRoomLyricsPreference";
import { LyricsNowPlayingCard } from "../features/lyrics/LyricsNowPlayingCard";
import { LyricsReader } from "../features/lyrics/LyricsReader";
import { LyricsViewControls } from "../features/lyrics/LyricsViewControls";
import {
  forgetLyricsFallback,
  rememberLyricsFallback,
} from "../features/lyrics/lyricsFallbackCache";
import { resolveLyricsLifecycle } from "../features/lyrics/lyricsLifecycle";
import { DEFAULT_LYRICS_VISUAL_SETTINGS } from "../features/lyrics/lyricsVisualSettings";
import { activeLyricIndex } from "../features/lyrics/lyricsTimeline";
import { useLyricsQuery } from "../features/lyrics/useLyricsQuery";
import { useLyricsFullscreen } from "../features/lyrics/useLyricsFullscreen";
import { useLyricsArtworkFocus } from "../features/lyrics/useLyricsArtworkFocus";
import { useLyricsCanvasPreference } from "../features/lyrics/useLyricsCanvasPreference";
import { useLyricsMotion } from "../features/lyrics/useLyricsMotion";
import { useLyricsViewMode } from "../features/lyrics/useLyricsViewMode";
import { usePointerIdle } from "../features/lyrics/usePointerIdle";
import {
  isPlaybackClockLive,
  resolvePlaybackDurationMs,
} from "../features/playback/playbackClock";
import { usePlaybackClock } from "../features/playback/usePlaybackClock";
import { usePlayback } from "../features/playback/usePlayback";
import { usePlaybackTruthRefresh } from "../features/playback/usePlaybackTruthRefresh";
import type { LyricsLine } from "../types/tauri";

export function LyricsPage() {
  const { playback, connected, seek, command } = usePlayback();
  const item = playback?.currentItem;
  const {
    cachedFallback,
    fallbackCacheKey,
    lyrics,
    lookupTimedOut,
    metadataReady,
    metadataTimedOut,
    settings,
  } = useLyricsQuery(
    item,
    playback?.durationMs,
  );
  usePlaybackTruthRefresh(connected && playback?.isPlaying === true);
  const currentTrackActions = useTrackContextMenu({
    track: item,
    canQueue: connected,
    saved: playback?.isSaved ?? false,
    onSavedChange: (_uri, saved) => {
      if (playback && saved !== playback.isSaved) {
        void command({ command: "toggleLike" });
      }
    },
  });

  const clock = usePlaybackClock({
    positionMs: playback?.positionMs ?? 0,
    durationMs: resolvePlaybackDurationMs(playback?.durationMs, item?.durationMs),
    repeatMode: playback?.repeatMode ?? "off",
    playing: playback?.isPlaying ?? false,
    suspended:
      !connected
      || seek.status.phase !== "idle"
      || !isPlaybackClockLive(playback?.clockReady),
    ...(item?.uri ? { trackKey: item.uri } : {}),
  });
  const position = clock.positionMs;

  const activeIndex = useMemo(
    () =>
      activeLyricIndex(
        lyrics.data?.lines ?? [],
        position,
      ),
    [lyrics.data?.lines, position],
  );

  const visualSettings =
    settings.data?.lyricsVisuals ??
    DEFAULT_LYRICS_VISUAL_SETTINGS;
  const lyricsLifecycle = resolveLyricsLifecycle({
    cachedFallback,
    document: lyrics.data,
    error: lyrics.error,
    hasTrack: Boolean(item),
    lyricsEnabled: settings.data?.lyricsEnabled,
    lookupTimedOut,
    metadataReady,
    metadataTimedOut,
    pending: lyrics.isPending,
  });

  useEffect(() => {
    if (lyricsLifecycle.hasLyrics) {
      forgetLyricsFallback(fallbackCacheKey);
    } else if (lyricsLifecycle.fallbackReason) {
      rememberLyricsFallback(
        fallbackCacheKey,
        lyricsLifecycle.fallbackReason,
      );
    }
  }, [
    fallbackCacheKey,
    lyricsLifecycle.fallbackReason,
    lyricsLifecycle.hasLyrics,
  ]);

  const view = useLyricsViewMode(lyricsLifecycle.lyricsAvailable);
  const fullscreen = useLyricsFullscreen();
  const idle = usePointerIdle(fullscreen.isFullscreen);
  const artworkFocus = useLyricsArtworkFocus();
  const cardCanvas = useLyricsCanvasPreference();
  const roomLyrics = useRoomLyricsPreference();
  const roomLines = lyricsLifecycle.hasLyrics ? lyrics.data?.lines ?? [] : [];
  const activeLine = lyrics.data?.lines[activeIndex];
  const {
    activeLineRef,
    followingPaused,
    readerRef,
    resumeFollowing,
  } = useLyricsMotion({
    activeIndex,
    activeLineStartMs: activeLine?.startMs,
    trackKey: item?.uri ?? "idle",
    cycle: clock.cycle,
    enabled: view.mode === "lyrics",
    layoutRevision: lyrics.data?.lines,
    synced: lyrics.data?.synced === true,
  });

  const songVideosEnabled = settings.data?.experimentalLibreCanvas === true;
  const canvasShown = songVideosEnabled && !cardCanvas.canvasHidden;

  const seekToLine = (line: LyricsLine) => {
    if (line.startMs === null || !connected) {
      return;
    }

    resumeFollowing();
    seek.begin();
    seek.preview(line.startMs);
    seek.commit();
  };

  return (
    <div
      className={`page lyrics-page view-${view.mode}${fullscreen.isFullscreen ? " is-fullscreen" : ""}${idle ? " is-idle" : ""}${artworkFocus.detailsHidden ? " is-artwork-focus" : ""}`}
    >
      <LyricsViewControls
        mode={view.mode}
        lyricsAvailable={view.lyricsAvailable}
        canvasAvailable={songVideosEnabled && Boolean(item?.canvasUrl)}
        canvasHidden={cardCanvas.canvasHidden}
        detailsHidden={artworkFocus.detailsHidden}
        fullscreen={fullscreen.isFullscreen}
        onModeChange={view.setMode}
        onToggleCanvas={cardCanvas.toggleCanvas}
        onToggleDetails={artworkFocus.toggleDetails}
        onToggleFullscreen={() => {
          void fullscreen.toggleFullscreen();
        }}
        roomLyrics={roomLines.length ? { hidden: roomLyrics.lyricsHidden, onToggle: roomLyrics.toggleLyrics } : undefined}
      />

      {view.mode === "room" ? (
        <CanvasRoom
          key={item?.uri ?? "empty"}
          item={item}
          connected={connected}
          playing={connected && playback?.isPlaying === true}
          songVideosEnabled={canvasShown}
          onContextMenu={currentTrackActions.onContextMenu}
          lyrics={roomLines.length && !roomLyrics.lyricsHidden ? {
            lines: roomLines,
            activeIndex,
            synced: lyrics.data?.synced === true,
            onSeek: seekToLine,
          } : undefined}
        />
      ) : view.mode === "cover" ? (
        <div className="lyrics-stage lyrics-cover-stage">
          <LyricsCoverView
            connected={connected}
            item={item}
            onContextMenu={currentTrackActions.onContextMenu}
            playing={connected && playback?.isPlaying === true}
            songVideosEnabled={canvasShown}
            visualSettings={visualSettings}
          />
        </div>
      ) : (
      <div className="lyrics-stage">
        <LyricsNowPlayingCard
          item={item}
          lyrics={lyrics.data}
          onContextMenu={currentTrackActions.onContextMenu}
          playing={connected && playback?.isPlaying === true}
          songVideosEnabled={canvasShown}
          visualSettings={visualSettings}
        />

        <LyricsReader
          item={item}
          settings={settings}
          lyrics={lyrics}
          metadataReady={metadataReady}
          activeIndex={activeIndex}
          activeLineRef={activeLineRef}
          readerRef={readerRef}
          connected={connected}
          followingPaused={followingPaused}
          onActivateLine={seekToLine}
          onResumeFollowing={resumeFollowing}
        />
      </div>
      )}
      {currentTrackActions.menu}
    </div>
  );
}
