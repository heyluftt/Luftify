import { invoke } from "@tauri-apps/api/core";
import type { TrackListeningStat } from "../analytics/analyticsTypes";

export const RECENTLY_PLAYED_QUERY_KEY = ["recently-played"] as const;

export function loadRecentlyPlayed() {
  return invoke<TrackListeningStat[]>("get_recently_played");
}
