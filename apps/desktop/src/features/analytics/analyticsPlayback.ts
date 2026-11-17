import type { AnalyticsTrack } from "./analyticsTypes";

interface AnalyticsPlaybackCommands {
  playUri: (uri: string) => void;
  playContext: (contextUri: string, trackUri: string) => void;
}

export function playAnalyticsTrack(
  track: AnalyticsTrack,
  commands: AnalyticsPlaybackCommands,
): void {
  if (isPlayableAlbumUri(track.albumUri)) {
    commands.playContext(track.albumUri, track.uri);
    return;
  }

  commands.playUri(track.uri);
}

function isPlayableAlbumUri(uri: string | undefined): uri is string {
  return Boolean(uri && (
    /^spotify:album:[A-Za-z0-9]+$/.test(uri)
    || uri.startsWith("mock:album:")
  ));
}
