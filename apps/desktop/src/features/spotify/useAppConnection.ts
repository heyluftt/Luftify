import { useQuery } from "@tanstack/react-query";
import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";

export const APP_CONNECTION_QUERY_KEY = ["app-connection"] as const;

/**
 * Demo mode and the startup phase of the backend process. Both only change
 * through pushed `startup://phase` events (StartupSync), so this never polls.
 */
export function useAppConnection() {
  const playbackConnection = usePlayerStore((store) => store.connection);
  const query = useQuery({
    queryKey: APP_CONNECTION_QUERY_KEY,
    queryFn: desktopApi.connectionInfo,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 2,
  });
  return { ...query, playbackConnection };
}
