import type { EntitySummary, MediaItem } from "@luft/protocol-types";
import { useQuery } from "@tanstack/react-query";
import { desktopApi } from "../../services/desktopApi";

const RELEASE_RADAR_REQUEST = { offset: 0, limit: 50 } as const;

export function useReleaseRadarReleases(
  playlist: EntitySummary | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["home", "release-radar-releases", playlist?.uri],
    queryFn: async () => {
      const details = await desktopApi.playlist(
        playlist!.uri,
        RELEASE_RADAR_REQUEST,
      );
      return releasesFromTracks(details.tracks).slice(0, 12);
    },
    enabled: enabled && playlist !== undefined,
    staleTime: 15 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });
}

export function releasesFromTracks(tracks: MediaItem[]): EntitySummary[] {
  const seen = new Set<string>();
  return tracks.flatMap((track): EntitySummary[] => {
    const uri = track.albumUri?.trim();
    const name = track.albumName?.trim() || track.title.trim();
    if (!uri?.startsWith("spotify:album:") || !name || seen.has(uri)) return [];
    seen.add(uri);

    const artists = track.creators
      .map((creator) => creator.name.trim())
      .filter(Boolean)
      .join(", ");
    return [{
      uri,
      name,
      subtitle: artists ? `Neu von ${artists}` : "Neu für dich",
      ...(track.coverUri ? { coverUri: track.coverUri } : {}),
    }];
  });
}
