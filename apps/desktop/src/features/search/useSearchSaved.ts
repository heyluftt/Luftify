import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { desktopApi } from "../../services/desktopApi";
import { useLikedLibrary, useLikedTrackUris } from "../library/libraryQueries";

/**
 * Saved hearts for search rows. The liked list only holds its loaded pages,
 * so older favourites looked unsaved; the full URI set comes from one cheap
 * backend lookup, the loaded pages cover engines that cannot list it.
 */
export function useSearchSaved() {
  const client = useQueryClient();
  const liked = useLikedLibrary();
  const likedUris = useLikedTrackUris();
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());

  const known = useMemo(
    () => new Set([
      ...(likedUris.data ?? []),
      ...(liked.view.data?.items.map((track) => track.uri) ?? []),
    ]),
    [liked.view.data, likedUris.data],
  );

  const save = useMutation({
    mutationFn: ({ uri, saved }: { uri: string; saved: boolean }) =>
      desktopApi.setTrackSaved(uri, saved),
    onMutate: ({ uri, saved }) => {
      const previous = overrides.get(uri) ?? known.has(uri);
      setOverrides((current) => new Map(current).set(uri, saved));
      return { uri, previous };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      setOverrides((current) => new Map(current).set(context.uri, context.previous));
    },
    onSettled: () => void client.invalidateQueries({ queryKey: ["library", "liked"] }),
  });

  return {
    isSaved: (uri: string) => overrides.get(uri) ?? known.has(uri),
    setSaved: (uri: string, saved: boolean) => save.mutate({ uri, saved }),
  };
}
