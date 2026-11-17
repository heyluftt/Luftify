import { useQuery } from "@tanstack/react-query";

import { desktopApi } from "../../services/desktopApi";
import type { LibrespotPhase } from "../../types/tauri";
import { isLibrespotPlaybackReady } from "../spotify/librespotCapabilities";
import { useAppConnection } from "../spotify/useAppConnection";

export const LIBRESPOT_STATUS_QUERY_KEY = ["librespot-status"] as const;

/**
 * Libre is the only engine. `localReady` is its session being connected;
 * `engineReady` also covers the mock provider of `--mock` runs.
 */
export function usePlaybackEngine(): {
  localReady: boolean;
  engineReady: boolean;
  mockMode: boolean;
  localPhase?: LibrespotPhase;
  credentialsPresent: boolean;
} {
  const connection = useAppConnection();
  const mockMode = connection.data?.mockMode === true;
  const librespot = useQuery({
    queryKey: LIBRESPOT_STATUS_QUERY_KEY,
    queryFn: desktopApi.librespotStatus,
    // Changes arrive as events (StartupSync); polling is only a safety net.
    staleTime: 2_000,
    refetchInterval: 15_000,
  });
  const localReady = isLibrespotPlaybackReady(librespot.data?.phase);
  return {
    localReady,
    engineReady: localReady || mockMode,
    mockMode,
    ...(librespot.data?.phase ? { localPhase: librespot.data.phase } : {}),
    credentialsPresent: librespot.data?.credentialsPresent === true,
  };
}
