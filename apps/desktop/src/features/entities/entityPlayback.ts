import type { MediaItem } from "@luft/protocol-types";

export type EntityPlaybackMode = "desktop" | "librespot";

export interface EntityPlaybackCommands {
  playUri: (uri: string, contextTracks?: MediaItem[]) => void;
  playContext: (contextUri: string, trackUri: string, contextTracks?: MediaItem[]) => void;
}

export function isPlayableAlbumUri(uri: string | undefined): uri is string {
  return Boolean(
    uri
    && (/^spotify:album:[A-Za-z0-9]+$/.test(uri) || uri.startsWith("mock:album:")),
  );
}

export function isPlayableArtistUri(uri: string | undefined): uri is string {
  return Boolean(
    uri
    && (/^spotify:artist:[A-Za-z0-9]+$/.test(uri) || uri.startsWith("mock:artist:")),
  );
}

export function playLibraryTrack(
  track: Pick<MediaItem, "uri" | "albumUri">,
  commands: EntityPlaybackCommands,
  context?: { uri: string; tracks: MediaItem[] },
  mode: EntityPlaybackMode = "desktop",
): void {
  if (mode === "librespot") {
    if (context?.uri && context.tracks.length > 0) {
      commands.playContext(context.uri, track.uri, context.tracks);
      return;
    }
    if (isPlayableAlbumUri(track.albumUri)) {
      commands.playContext(track.albumUri, track.uri);
      return;
    }
    commands.playUri(track.uri);
    return;
  }

  if (context?.uri && isPlayableAlbumUri(context.uri)) {
    commands.playContext(context.uri, track.uri);
    return;
  }
  commands.playUri(track.uri);
}

export function playLibraryContext(
  contextUri: string,
  tracks: MediaItem[] | undefined,
  commands: Pick<EntityPlaybackCommands, "playUri">,
  mode: EntityPlaybackMode = "desktop",
): void {
  if (mode === "librespot" && tracks?.length) {
    commands.playUri(contextUri, tracks);
    return;
  }
  commands.playUri(contextUri);
}
