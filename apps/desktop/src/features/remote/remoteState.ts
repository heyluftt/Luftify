import type { PlaybackState } from "@luft/protocol-types";
import type { RemoteState } from "./remoteTypes";

/** What the phone needs to show this PC's player. */
export function remoteStateOf(playback: PlaybackState | undefined): RemoteState {
  const item = playback?.currentItem;
  const track = item?.uri.startsWith("spotify:track:")
    ? {
      provider: "spotify" as const,
      uri: item.uri,
      title: item.title,
      artists: item.creators.map((creator) => creator.name),
      ...(item.coverUri?.startsWith("https://") ? { coverUri: item.coverUri } : {}),
      ...(playback?.durationMs ? { durationMs: playback.durationMs } : {}),
    }
    : undefined;
  return {
    ...(track ? { track } : {}),
    isPlaying: Boolean(playback?.isPlaying && track),
    positionMs: Math.max(0, Math.round(playback?.positionMs ?? 0)),
    durationMs: Math.round(playback?.durationMs ?? 0),
    volume: Math.min(1, Math.max(0, playback?.isMuted ? 0 : playback?.volume ?? 0)),
    liked: Boolean(playback?.isSaved),
    ...(playback?.contextUri ? { contextUri: playback.contextUri } : {}),
  };
}

/** Worth telling the phone at once: another song, play/pause, volume, like, or a jump. */
export function remoteStateChanged(before: RemoteState | null, after: RemoteState, elapsedMs: number): boolean {
  if (!before) return true;
  if (before.track?.uri !== after.track?.uri || before.isPlaying !== after.isPlaying || before.liked !== after.liked) return true;
  if (Math.abs(before.volume - after.volume) > 0.01) return true;
  const expected = before.positionMs + (before.isPlaying ? elapsedMs : 0);
  return Math.abs(after.positionMs - expected) > 2_500;
}
