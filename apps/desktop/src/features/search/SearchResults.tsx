import type { EntitySummary, SearchResult } from "@luft/protocol-types";
import { useEffect, useMemo, useState } from "react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { useEngineCapability } from "../spotify/useEngineCapability";
import type { SearchEntityCategory } from "./searchEntityKind";
import { SearchEntitySection } from "./SearchEntitySection";
import { SearchFilters } from "./SearchFilters";
import { SearchNoResults } from "./SearchNoResults";
import { SearchTopResult } from "./SearchTopResult";
import { SearchTrackSection } from "./SearchTrackSection";
import { pickTopResult, type SearchHit } from "./searchRanking";
import {
  searchCounts,
  type SearchCategory,
  type SearchCounts,
} from "./searchTypes";
import { useSearchHitActions } from "./useSearchHitActions";

/** Tracks beside the top result in the overview. */
const OVERVIEW_TRACKS = 5;

export type SearchResultsProps = {
  data: SearchResult;
  isSaved: (uri: string) => boolean;
  onSavedChange: (uri: string, saved: boolean) => void;
  /** An older answer shown while the current query loads. */
  stale?: boolean;
  category?: SearchCategory;
  counts?: SearchCounts;
  onCategoryChange?: (category: SearchCategory) => void;
  onPick?: (hit: SearchHit) => void;
};

const ENTITY_SECTIONS: { category: SearchEntityCategory; title: () => string }[] = [
  { category: "artists", title: () => t("search.filter.artists") },
  { category: "albums", title: () => t("search.filter.albums") },
  { category: "playlists", title: () => t("search.filter.playlists") },
];

export function SearchResults({
  data,
  isSaved,
  onSavedChange,
  stale = false,
  category,
  counts: providedCounts,
  onCategoryChange,
  onPick,
}: SearchResultsProps) {
  const canQueue = useEngineCapability("queue.add");
  const actions = useSearchHitActions(onPick);
  const [localCategory, setLocalCategory] = useState<SearchCategory>("all");

  const fallbackCounts = useMemo(() => searchCounts(data), [data]);
  const counts = providedCounts ?? fallbackCounts;
  const selectedCategory = category ?? localCategory;
  const top = useMemo(() => pickTopResult(data), [data]);
  const unavailable = useMemo(
    () =>
      new Set<SearchCategory>(
        data.unavailable
          .map((capability) =>
            capability.startsWith("search.")
              ? capability.slice("search.".length)
              : capability,
          )
          .filter(
            (value): value is SearchCategory =>
              value === "tracks" ||
              value === "artists" ||
              value === "albums" ||
              value === "playlists",
          ),
      ),
    [data.unavailable],
  );

  useEffect(() => {
    if (category === undefined) {
      setLocalCategory("all");
    }
  }, [category, data.query]);

  useEffect(() => {
    if (stale) return;
    if (
      selectedCategory !== "all" &&
      (counts[selectedCategory] === 0 ||
        unavailable.has(selectedCategory))
    ) {
      if (category === undefined) {
        setLocalCategory("all");
      } else {
        onCategoryChange?.("all");
      }
    }
  }, [
    category,
    counts,
    onCategoryChange,
    selectedCategory,
    stale,
    unavailable,
  ]);

  if (counts.all === 0) {
    return stale ? null : (
      <SearchNoResults
        query={data.query}
        partialUnavailable={unavailable.size > 0}
      />
    );
  }

  const changeCategory = (nextCategory: SearchCategory) => {
    if (category === undefined) {
      setLocalCategory(nextCategory);
    }
    onCategoryChange?.(nextCategory);
    window.requestAnimationFrame(() => {
      document.querySelector(".search-results")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  const overview = selectedCategory === "all";
  const openEntity = (entry: EntitySummary, kind: SearchEntityCategory) =>
    actions.open({ kind, entry });
  const playTrack = (uri: string) => {
    const track = data.tracks.find((item) => item.uri === uri);
    if (track) actions.playTrack(track);
  };
  const queue = canQueue
    ? {
        onQueue: (uri: string) => {
          void desktopApi.addToQueue(uri, data.tracks.find((track) => track.uri === uri));
        },
      }
    : {};
  const trackSection = (
    <SearchTrackSection
      tracks={data.tracks}
      isSaved={isSaved}
      onSavedChange={onSavedChange}
      onPlay={playTrack}
      {...queue}
      {...(overview
        ? {
            limit: OVERVIEW_TRACKS,
            ...(data.tracks.length > OVERVIEW_TRACKS
              ? { onShowAll: () => changeCategory("tracks") }
              : {}),
          }
        : {})}
    />
  );

  return (
    <div
      className={stale ? "search-results is-stale" : "search-results"}
      aria-busy={stale}
    >
      <div className="search-results-toolbar">
        <div className="search-results-summary">
          <span>{t("search.resultsFor")}</span>
          <strong title={data.query}>„{data.query}“</strong>
          {data.unavailable.length > 0 && (
            <small title={t("search.partialHint")}>
              {t("search.partial")}
            </small>
          )}
        </div>

        <SearchFilters
          active={selectedCategory}
          counts={counts}
          unavailable={unavailable}
          onChange={changeCategory}
        />
      </div>

      <div
        className="search-results-content"
        role="tabpanel"
        aria-live="polite"
      >
        {overview ? (
          <>
            {top && data.tracks.length > 0 ? (
              <div className="search-overview-lead">
                <SearchTopResult hit={top} onOpen={actions.open} onPlay={actions.play} />
                {trackSection}
              </div>
            ) : top ? (
              <SearchTopResult hit={top} onOpen={actions.open} onPlay={actions.play} />
            ) : null}

            {ENTITY_SECTIONS.map(({ category: kind, title }) => (
              <SearchEntitySection
                key={kind}
                title={title()}
                entries={data[kind]}
                category={kind}
                onOpen={openEntity}
                preview
                onShowAll={() => changeCategory(kind)}
              />
            ))}
          </>
        ) : selectedCategory === "tracks" ? (
          trackSection
        ) : (
          ENTITY_SECTIONS.filter(({ category: kind }) => kind === selectedCategory).map(({ category: kind, title }) => (
            <SearchEntitySection
              key={kind}
              title={title()}
              entries={data[kind]}
              category={kind}
              onOpen={openEntity}
            />
          ))
        )}
      </div>
    </div>
  );
}
