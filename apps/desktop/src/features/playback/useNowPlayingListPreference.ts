import { useQuery } from "@tanstack/react-query";
import { desktopApi } from "../../services/desktopApi";

export const DEFAULT_NOW_PLAYING_LIST_NAVIGATION_ENABLED = true;

export function useNowPlayingListNavigationEnabled(): boolean {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: desktopApi.settings,
    staleTime: 30_000,
  });

  return settings.data?.nowPlayingListNavigationEnabled
    ?? DEFAULT_NOW_PLAYING_LIST_NAVIGATION_ENABLED;
}
