import type { MediaItem } from "@luft/protocol-types";

const normalize = (value: string | undefined) =>
  (value ?? "").normalize("NFKC").trim().toLocaleLowerCase();

/**
 * Row to jump to for "From: playlist". The URI wins; when Spotify relinked
 * the playing track (regional substitute with another URI), the same title
 * by the same lead artist is the playlist entry that was started.
 */
export function findFocusTrackIndex(
  tracks: MediaItem[],
  trackUri: string,
  playing?: Pick<MediaItem, "title" | "creators">,
): number {
  const exact = tracks.findIndex((track) => track.uri === trackUri);
  if (exact >= 0 || !playing) return exact;
  const title = normalize(playing.title);
  const artist = normalize(playing.creators[0]?.name);
  if (!title || !artist) return -1;
  return tracks.findIndex((track) =>
    normalize(track.title) === title && normalize(track.creators[0]?.name) === artist);
}
