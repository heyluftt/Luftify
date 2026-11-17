import { useCallback, useEffect, useState } from "react";

interface PagedQuery {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isError: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/**
 * Sorting or filtering liked songs by title only makes sense on all of
 * them; once asked, this keeps loading pages until the list is complete.
 */
export function useLikedLoadAll(query: PagedQuery) {
  const [wanted, setWanted] = useState(false);
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;

  useEffect(() => {
    if (!wanted) return;
    if (!hasNextPage || isError) {
      setWanted(false);
      return;
    }
    if (!isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isError, isFetchingNextPage, wanted]);

  return {
    request: useCallback(() => setWanted(true), []),
    active: wanted && hasNextPage,
  };
}
