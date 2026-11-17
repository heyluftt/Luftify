import type { MediaItem } from "@luft/protocol-types";
import { useNavigate } from "react-router-dom";
import { playLibraryTrack } from "../entities/entityPlayback";
import { usePlayback } from "../playback/usePlayback";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import type { SearchEntityCategory } from "./searchEntityKind";
import type { SearchHit } from "./searchRanking";

const ROUTES: Record<SearchEntityCategory, string> = {
  artists: "artist",
  albums: "album",
  playlists: "playlist",
};

export function searchEntityPath(category: SearchEntityCategory, uri: string): string {
  return `/${ROUTES[category]}/${encodeURIComponent(uri)}`;
}

/** Opening and playing a search hit; `onPick` hears about every one. */
export function useSearchHitActions(onPick?: (hit: SearchHit) => void) {
  const navigate = useNavigate();
  const playback = usePlayback();
  const { localReady: librespotReady } = usePlaybackEngine();

  const playTrack = (track: MediaItem) => {
    if (!librespotReady) {
      void playback.playUri(track.uri);
      return;
    }
    playLibraryTrack(track, playback, undefined, "librespot");
  };

  return {
    playTrack: (track: MediaItem) => {
      onPick?.({ kind: "tracks", track });
      playTrack(track);
    },
    open: (hit: SearchHit) => {
      onPick?.(hit);
      if (hit.kind === "tracks") {
        playTrack(hit.track);
        return;
      }
      navigate(searchEntityPath(hit.kind, hit.entry.uri), { state: hit.entry });
    },
    play: (hit: SearchHit) => {
      onPick?.(hit);
      if (hit.kind === "tracks") {
        playTrack(hit.track);
        return;
      }
      void playback.playUri(hit.entry.uri);
    },
  };
}

/** Artists are opened; their page decides what plays (top tracks). */
export function canPlayHit(hit: SearchHit): boolean {
  return hit.kind !== "artists";
}
