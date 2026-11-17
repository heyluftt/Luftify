import type { MediaItem } from "@luft/protocol-types";

export function filterPlaylistTracks(
  tracks: MediaItem[],
  query: string,
): MediaItem[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return tracks;

  return tracks.filter((track) => {
    const searchable = normalize(
      [
        track.title,
        track.albumName,
        ...track.creators.map((creator) => creator.name),
      ]
        .filter(Boolean)
        .join(" "),
    );
    return terms.every((term) => searchable.includes(term));
  });
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-DE")
    .trim();
}
