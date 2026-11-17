import { Heart, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { formatTime } from "../playback/formatTime";
import { isPlaybackClockLive, resolvePlaybackDurationMs } from "../playback/playbackClock";
import { playbackCommands } from "../playback/playbackCommands";
import { SmoothProgressTrack } from "../playback/SmoothProgressTrack";
import { usePlayback } from "../playback/usePlayback";
import { usePlaybackClock } from "../playback/usePlaybackClock";

/** What is playing, with the everyday controls one click away. */
export function PaletteNowPlaying() {
  const { playback, connected, seek } = usePlayback();
  const item = playback?.currentItem;
  const durationMs = resolvePlaybackDurationMs(playback?.durationMs, item?.durationMs);
  const seekActive = seek.status.phase !== "idle";
  const live = isPlaybackClockLive(playback?.clockReady);
  const clock = usePlaybackClock({
    positionMs: playback?.positionMs ?? 0,
    durationMs,
    repeatMode: playback?.repeatMode ?? "off",
    playing: Boolean(playback?.isPlaying && item),
    suspended: seekActive || !connected || !live,
    ...(item?.uri ? { trackKey: item.uri } : {}),
    resolutionMs: 1_000,
  });
  if (!item) return null;

  const playing = playback?.isPlaying === true;
  const running = playing && connected && !seekActive && live;
  const artists = item.creators.map((creator) => creator.name).join(", ") || t("player.unknownArtist");
  return (
    <section className="command-palette-now" aria-label={t("command.controls")}>
      <AlbumArt title={item.title} size="tiny" image={item.coverUri} />
      <div className="command-palette-now-copy">
        <strong>{item.title}</strong>
        <small>{artists}</small>
        <div className="command-palette-now-time">
          <span>{formatTime(clock.positionMs)}</span>
          <SmoothProgressTrack className="command-palette-now-progress" positionMs={clock.positionMs} durationMs={durationMs} running={running} {...(item.uri ? { trackKey: item.uri } : {})} />
          <span>{durationMs > 0 ? formatTime(durationMs) : "–:––"}</span>
        </div>
      </div>
      <div className="command-palette-now-controls">
        <button type="button" tabIndex={-1} disabled={!connected} aria-label={t("player.previous")} title={t("player.previous")} onClick={() => playbackCommands.send({ command: "previous" })}>
          <SkipBack size={15} fill="currentColor" />
        </button>
        <button type="button" tabIndex={-1} className="is-main" disabled={!connected} aria-label={playing ? t("command.pause") : t("command.play")} title={playing ? t("command.pause") : t("command.play")} onClick={() => playbackCommands.send({ command: playing ? "pause" : "play" })}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <button type="button" tabIndex={-1} disabled={!connected} aria-label={t("player.next")} title={t("player.next")} onClick={() => playbackCommands.send({ command: "next" })}>
          <SkipForward size={15} fill="currentColor" />
        </button>
        <button type="button" tabIndex={-1} className={playback?.isSaved ? "is-liked" : undefined} disabled={!connected} aria-pressed={playback?.isSaved === true} aria-label={playback?.isSaved ? t("player.unlike") : t("player.like")} title={playback?.isSaved ? t("player.unlike") : t("player.like")} onClick={() => playbackCommands.send({ command: "toggleLike" })}>
          <Heart size={15} fill={playback?.isSaved ? "currentColor" : "none"} />
        </button>
      </div>
    </section>
  );
}
