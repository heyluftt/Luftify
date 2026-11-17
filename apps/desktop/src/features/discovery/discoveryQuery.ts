import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { generateDiscovery } from "./discoveryService";
import { initializeMixLibrary, recentMixTrackUris, useMixLibrary } from "./mixLibrary";

export function discoveryQuery(client: QueryClient) {
  return queryOptions({
    queryKey: ["discovery-mix"],
    queryFn: async ({ signal }) => {
      await initializeMixLibrary();
      if (!useMixLibrary.getState().ready) throw new Error("Mix storage unavailable");
      const previous = client.getQueryData<Awaited<ReturnType<typeof generateDiscovery>>>(["discovery-mix"]);
      const { mixes } = useMixLibrary.getState();
      const result = await generateDiscovery(
        signal,
        recentMixTrackUris(mixes, previous?.picks ?? []),
        [...(previous?.picks ?? []), ...mixes.flatMap((mix) => mix.picks)],
      );
      if (!signal.aborted) useMixLibrary.getState().add(result.picks);
      return result;
    },
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
