import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { t } from "../i18n";
import { categoryHasMore } from "../features/search/combineSearchPages";
import { SearchEmpty } from "../features/search/SearchEmpty";
import { SearchFeedback } from "../features/search/SearchFeedback";
import { SearchField } from "../features/search/SearchField";
import { SearchLibraryMatches } from "../features/search/SearchLibraryMatches";
import { SearchLoadMore } from "../features/search/SearchLoadMore";
import { SearchResults } from "../features/search/SearchResults";
import { useSearchController } from "../features/search/useSearchController";
import { useSearchHitActions } from "../features/search/useSearchHitActions";
import { useSearchSaved } from "../features/search/useSearchSaved";
import { desktopApi } from "../services/desktopApi";

export function SearchPage() {
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const search = useSearchController();
  const saved = useSearchSaved();
  const actions = useSearchHitActions(search.pick);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const selectQuery = (value: string) => {
    search.setQuery(value);
    window.requestAnimationFrame(() => input.current?.focus());
  };

  const retry = async () => {
    if (!search.searchReady) {
      await client.invalidateQueries({ queryKey: ["librespot-status"] });
      return;
    }

    await search.result.refetch();
  };

  const focusFirstResult = () => {
    document
      .querySelector<HTMLElement>(
        ".search-page .search-library-matches button, .search-results-content button, .search-results-content [tabindex='0']",
      )
      ?.focus();
  };

  const loading =
    search.inputPending ||
    (search.result.isFetching &&
      !search.result.isFetchingNextPage);
  const shown = search.data ?? search.staleData;
  const canLoadMore = Boolean(search.data)
    && search.category !== "all"
    && categoryHasMore(search.result.data?.pages, search.category);
  const showLibrary = search.normalizedQuery.length >= 2
    && (search.category === "all" || search.category === "playlists");

  return (
    <div className="page search-page">
      <header className="search-page-header">
        <h1>{t("nav.search")}</h1>
      </header>

      <SearchField
        inputRef={input}
        value={search.query}
        onChange={search.setQuery}
        onSubmit={() => search.submit()}
        inputPending={loading}
        onFocusResults={focusFirstResult}
        {...(search.data
          ? { resultCount: search.counts.all }
          : {})}
      />

      {!search.normalizedQuery && (
        <SearchEmpty
          onSelect={selectQuery}
          history={search.history}
          picks={search.picks}
          historyEnabled={search.historyEnabled}
          onRemoveHistory={search.removeHistory}
          onClearHistory={search.clearHistory}
          onOpenPick={actions.open}
          onRemovePick={search.removePick}
        />
      )}

      {showLibrary && (
        <SearchLibraryMatches
          query={search.normalizedQuery}
          onOpen={(entry) => actions.open({ kind: "playlists", entry })}
        />
      )}

      {search.normalizedQuery && (
        <SearchFeedback
          connecting={search.connecting}
          capabilityMissing={search.capabilityMissing}
          searchReady={search.searchReady}
          loading={loading}
          hasData={Boolean(shown)}
          error={!search.inputPending && search.result.isError}
          onRetry={() => void retry()}
        />
      )}

      {shown && search.normalizedQuery && !(search.result.isError && !search.inputPending) && (
        <SearchResults
          data={shown}
          stale={!search.data}
          category={search.category}
          counts={search.counts}
          onCategoryChange={search.setCategory}
          isSaved={saved.isSaved}
          onSavedChange={saved.setSaved}
          onPick={search.pick}
        />
      )}

      {canLoadMore && (
        <SearchLoadMore
          loading={search.result.isFetchingNextPage}
          onLoad={() => void search.result.fetchNextPage()}
        />
      )}
    </div>
  );
}
