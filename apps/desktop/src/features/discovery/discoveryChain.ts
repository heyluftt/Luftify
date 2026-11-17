import type { MediaCreator, MediaItem } from "@luft/protocol-types";
import type { TrackSignal } from "./discoveryFeedback";

const normalize = (name: string) => name.normalize("NFKC").trim().toLowerCase();

// Main artists of earlier mix titles that landed, newest enjoyment first.
// These continue the discovery chain as seeds for the next mix.
export function enjoyedMixArtists(
  history: readonly { track: MediaItem }[],
  signal: (uri: string) => TrackSignal | undefined,
  limit = 4,
): MediaCreator[] {
  const enjoyed = history
    .map(({ track }) => ({ track, feedback: signal(track.uri) }))
    .filter(({ feedback }) => feedback?.enjoyed)
    .sort((a, b) => (b.feedback!.enjoyedAtMs ?? 0) - (a.feedback!.enjoyedAtMs ?? 0));
  const names = new Set<string>();
  const artists: MediaCreator[] = [];
  for (const { track } of enjoyed) {
    const main = track.creators[0];
    if (!main || !main.name.trim() || names.has(normalize(main.name))) continue;
    names.add(normalize(main.name));
    artists.push(main);
    if (artists.length >= limit) break;
  }
  return artists;
}
