import { t } from "../../i18n";
import { formatTime } from "../playback/formatTime";
import { isPlaybackClockLive, resolvePlaybackDurationMs } from "../playback/playbackClock";
import { SmoothProgressTrack } from "../playback/SmoothProgressTrack";
import { usePlayback } from "../playback/usePlayback";
import { usePlaybackClock } from "../playback/usePlaybackClock";

// Keep clock ticks local so cover, controls and settings do not rerender with time.
export function MiniPlayerProgress({ hidden = false }: { hidden?: boolean }) {
  const { playback, connected, seek } = usePlayback();
  const item = playback?.currentItem;
  const durationMs = resolvePlaybackDurationMs(playback?.durationMs, item?.durationMs);
  const seekActive = seek.status.phase !== "idle";
  const clock = usePlaybackClock({
    positionMs: playback?.positionMs ?? 0,
    durationMs,
    repeatMode: playback?.repeatMode ?? "off",
    playing: Boolean(playback?.isPlaying && item),
    suspended: seekActive || !connected || !isPlaybackClockLive(playback?.clockReady),
    ...(item?.uri ? { trackKey: item.uri } : {}),
    resolutionMs: 1_000,
  });
  const previewSeek = (value: number) => {
    if (seek.status.phase === "idle") seek.begin();
    seek.preview(value);
  };

  // Keep the clock mounted while settings replace the visible controls.
  if (hidden) return null;

  const running = Boolean(playback?.isPlaying && connected && !seekActive && isPlaybackClockLive(playback?.clockReady));
  return (
    <div className="miniplayer-timeline">
      <span aria-hidden="true">{formatTime(clock.positionMs)}</span>
      <SmoothProgressTrack className="miniplayer-progress" pixelStep positionMs={clock.positionMs} durationMs={durationMs} running={running} {...(item?.uri ? { trackKey: item.uri } : {})}>
        <input aria-label={t("player.progress")} disabled={!connected || durationMs <= 0} type="range" min={0} max={Math.max(durationMs, 1)} value={clock.positionMs} onPointerDown={() => seek.begin()} onChange={(event) => previewSeek(Number(event.currentTarget.value))} onPointerUp={() => seek.commit()} onPointerCancel={() => seek.commit()} onKeyUp={() => seek.commit()} onBlur={() => seek.commit()} />
      </SmoothProgressTrack>
      <span aria-hidden="true">{durationMs > 0 ? formatTime(durationMs) : "–:––"}</span>
    </div>
  );
}
