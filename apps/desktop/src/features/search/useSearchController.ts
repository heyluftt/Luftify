import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { nextPageOffset } from "../pagination";
import { combineSearchPages } from "./combineSearchPages";
import {
  clearSearchHistory,
  forgetSearchPick,
  forgetSearchQuery,
  readSearchHistory,
  readSearchPicks,
  rememberSearchPick,
  rememberSearchQuery,
} from "./searchHistory";
import type { SearchHit } from "./searchRanking";
import {
  isSearchCategory,
  normalizeSearchQuery,
  searchCounts,
  type SearchCategory,
} from "./searchTypes";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_PAGE_SIZE = 24;
/** A query that stays this long is a search, not a step of typing. */
const HISTORY_SETTLE_MS = 1_600;

export function useSearchController() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { localReady: librespotReady, engineReady, mockMode } = usePlaybackEngine();
  const connectionEpoch = usePlayerStore((store) => store.connectionEpoch);
  const playbackConnection = usePlayerStore((store) => store.connection);
  const routeQuery = params.get("q") ?? "";
  const routeCategory = params.get("type");
  const [query, setQueryState] = useState(routeQuery);
  const [category, setCategoryState] = useState<SearchCategory>(
    isSearchCategory(routeCategory) ? routeCategory : "all",
  );
  const [history, setHistory] = useState(readSearchHistory);
  const [picks, setPicks] = useState(readSearchPicks);
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const lastRemembered = useRef("");
  const normalizedQuery = normalizeSearchQuery(query);
  const debouncedQuery = useDebouncedValue(normalizedQuery, SEARCH_DEBOUNCE_MS);
  const activeQuery = submittedQuery ?? debouncedQuery;
  const inputPending = normalizedQuery !== activeQuery;

  useEffect(() => {
    setQueryState(routeQuery);
    setCategoryState(isSearchCategory(routeCategory) ? routeCategory : "all");
    setSubmittedQuery(null);
  }, [routeCategory, routeQuery]);

  useEffect(() => {
    if (submittedQuery === null || debouncedQuery !== submittedQuery) return;
    setSubmittedQuery(null);
  }, [debouncedQuery, submittedQuery]);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: desktopApi.settings,
    staleTime: 60_000,
  });
  const historyEnabled = settings.data?.searchHistoryEnabled === true;

  useEffect(() => {
    if (!settings.data || historyEnabled) return;
    clearSearchHistory();
    setHistory([]);
    setPicks([]);
  }, [historyEnabled, settings.data]);

  const setUrlState = useCallback(
    (nextQuery: string, nextCategory: SearchCategory) => {
      const next = new URLSearchParams();
      const normalized = normalizeSearchQuery(nextQuery);
      if (normalized) next.set("q", normalized);
      if (nextCategory !== "all") next.set("type", nextCategory);
      setParams(next, { replace: true });
    },
    [setParams],
  );

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value);
      setSubmittedQuery(null);
      setUrlState(value, category);
    },
    [category, setUrlState],
  );

  const remember = useCallback((value: string) => {
    if (!historyEnabled || value.length < 2 || lastRemembered.current === value) return;
    setHistory(rememberSearchQuery(value, lastRemembered.current || undefined));
    lastRemembered.current = value;
  }, [historyEnabled]);

  const submit = useCallback(() => {
    if (!normalizedQuery) return;
    setSubmittedQuery(normalizedQuery);
    setUrlState(normalizedQuery, category);
    remember(normalizedQuery);
  }, [category, normalizedQuery, remember, setUrlState]);

  const setCategory = useCallback(
    (value: SearchCategory) => {
      setCategoryState(value);
      setUrlState(query, value);
    },
    [query, setUrlState],
  );

  const searchReady = engineReady;

  const connectionKey = `${connectionEpoch}:${librespotReady}:${mockMode}:${playbackConnection}`;
  const lastConnectionKey = useRef(connectionKey);
  useEffect(() => {
    if (lastConnectionKey.current === connectionKey) return;
    lastConnectionKey.current = connectionKey;
    if (playbackConnection !== "online" && !mockMode && !librespotReady) {
      void queryClient.cancelQueries({ queryKey: ["search"] });
      queryClient.removeQueries({ queryKey: ["search"] });
      return;
    }
    // A cancelled fetch falls back to "no data" and never runs again, which
    // left the page blank when the connection settled mid-search (e.g. a
    // query opened right at startup). Ask again on the new connection.
    void queryClient
      .cancelQueries({ queryKey: ["search"] })
      .then(() => queryClient.refetchQueries({ queryKey: ["search"], type: "active" }));
  }, [connectionKey, librespotReady, mockMode, playbackConnection, queryClient]);

  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: ["search"] });
    },
    [queryClient],
  );

  const result = useInfiniteQuery({
    queryKey: [
      "search",
      "librespot",
      connectionEpoch,
      activeQuery,
    ],
    queryFn: ({ pageParam, signal }) =>
      desktopApi.search(
        {
          query: activeQuery,
          offset: pageParam,
          limit: SEARCH_PAGE_SIZE,
        },
        signal,
      ),
    initialPageParam: 0,
    getNextPageParam: nextPageOffset,
    enabled:
      activeQuery.length > 0 &&
      activeQuery.length <= 200 &&
      searchReady &&
      !inputPending,
    staleTime: 30_000,
    retry: false,
  });

  const combined = useMemo(
    () => combineSearchPages(result.data?.pages),
    [result.data],
  );
  const currentResult =
    !inputPending && combined?.query === activeQuery ? combined : undefined;
  // While the next query loads, the last answer stays (dimmed) instead of
  // collapsing into a skeleton on every keystroke.
  const lastResult = useRef(currentResult);
  if (currentResult) lastResult.current = currentResult;
  if (!normalizedQuery) lastResult.current = undefined;
  const staleResult = currentResult ? undefined : lastResult.current;

  const settledQuery = useDebouncedValue(activeQuery, HISTORY_SETTLE_MS);
  useEffect(() => {
    if (currentResult && settledQuery === currentResult.query && searchCounts(currentResult).all > 0) {
      remember(settledQuery);
    }
  }, [currentResult, remember, settledQuery]);

  const removeHistory = useCallback((value: string) => {
    setHistory(forgetSearchQuery(value));
  }, []);

  const clearHistory = useCallback(() => {
    clearSearchHistory();
    setHistory([]);
    setPicks([]);
    lastRemembered.current = "";
  }, []);

  /** A result the listener opened or played: the query was worth keeping. */
  const pick = useCallback((hit: SearchHit) => {
    if (!historyEnabled) return;
    if (currentResult) remember(currentResult.query);
    setPicks(rememberSearchPick(hit));
  }, [currentResult, historyEnabled, remember]);

  const removePick = useCallback((uri: string) => {
    setPicks(forgetSearchPick(uri));
  }, []);

  return {
    query,
    normalizedQuery,
    activeQuery,
    category,
    setQuery,
    submit,
    setCategory,
    inputPending,
    result,
    data: currentResult,
    staleData: staleResult,
    counts: searchCounts(currentResult ?? staleResult),
    history: historyEnabled ? history : [],
    picks: historyEnabled ? picks : [],
    historyEnabled,
    removeHistory,
    clearHistory,
    pick,
    removePick,
    connecting: activeQuery.length > 0 && !searchReady,
    capabilityMissing: false,
    searchReady,
  };
}
