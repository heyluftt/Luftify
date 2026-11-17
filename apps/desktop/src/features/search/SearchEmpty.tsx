import {
  Clock3,
  History,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AlbumArt } from "../../components/AlbumArt";
import { t, type MessageKey } from "../../i18n";
import { entitySubtitle, searchKindLabel } from "./searchEntityKind";
import { hitName, hitUri, type SearchHit } from "./searchRanking";

type SearchEmptyProps = {
  onSelect: (query: string) => void;
  history?: readonly string[];
  picks?: readonly SearchHit[];
  onRemoveHistory?: (query: string) => void;
  onClearHistory?: () => void;
  onOpenPick?: (hit: SearchHit) => void;
  onRemovePick?: (uri: string) => void;
  historyEnabled?: boolean;
};

const QUICK_SEARCHES: MessageKey[] = [
  "search.suggestion.weekly",
  "search.suggestion.radar",
  "search.suggestion.daily",
  "search.suggestion.new",
];

export function SearchEmpty({
  onSelect,
  history = [],
  picks = [],
  onRemoveHistory,
  onClearHistory,
  onOpenPick,
  onRemovePick,
  historyEnabled = true,
}: SearchEmptyProps) {
  const visibleHistory = historyEnabled ? history.slice(0, 6) : [];
  const visiblePicks = historyEnabled && onOpenPick ? picks.slice(0, 6) : [];
  const hasHistory = visibleHistory.length > 0 || visiblePicks.length > 0;

  return (
    <section
      className={visiblePicks.length > 0 ? "search-empty has-picks" : "search-empty"}
      aria-label={t("search.suggestions")}
    >
      {visiblePicks.length > 0 && (
        <div className="search-suggestion-group search-picks">
          <div className="search-suggestion-heading">
            <span>
              <History size={14} aria-hidden="true" />
              {t("search.recentPicks")}
            </span>
          </div>

          <ul className="search-pick-list">
            {visiblePicks.map((hit) => (
              <SearchPickRow
                key={hitUri(hit)}
                hit={hit}
                onOpen={() => onOpenPick?.(hit)}
                {...(onRemovePick ? { onRemove: () => onRemovePick(hitUri(hit)) } : {})}
              />
            ))}
          </ul>
        </div>
      )}

      <div className="search-empty-groups">
        {visibleHistory.length > 0 && (
          <div className="search-suggestion-group">
            <div className="search-suggestion-heading">
              <span>
                <Clock3 size={14} aria-hidden="true" />
                {t("search.recentQueries")}
              </span>
            </div>

            <div className="search-suggestion-list">
              {visibleHistory.map((query) => (
                <span className="search-history-item" key={query}>
                  <button type="button" title={query} onClick={() => onSelect(query)}>
                    {query}
                  </button>

                  {onRemoveHistory && (
                    <button
                      type="button"
                      aria-label={t("search.removeHistory", { query })}
                      onClick={() => onRemoveHistory(query)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="search-suggestion-group">
          <div className="search-suggestion-heading">
            <span>
              <Sparkles size={14} aria-hidden="true" />
              {t("search.suggestions")}
            </span>
          </div>

          <div className="search-suggestion-list">
            {QUICK_SEARCHES.map((key) => {
              const query = t(key);
              return (
                <button type="button" key={key} onClick={() => onSelect(query)}>
                  {query}
                </button>
              );
            })}
          </div>
        </div>

        {hasHistory && onClearHistory && (
          <button type="button" className="search-history-clear" onClick={onClearHistory}>
            <Trash2 size={13} aria-hidden="true" />
            {t("search.clearHistory")}
          </button>
        )}
      </div>
    </section>
  );
}

function SearchPickRow({
  hit,
  onOpen,
  onRemove,
}: {
  hit: SearchHit;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  const name = hitName(hit);
  const cover = hit.kind === "tracks" ? hit.track.coverUri : hit.entry.coverUri;
  const kind = searchKindLabel(hit.kind);
  const owner = hit.kind === "tracks"
    ? hit.track.creators.map((creator) => creator.name).join(", ")
    : entitySubtitle(hit.entry, hit.kind);
  const detail = owner && owner !== kind ? `${kind} · ${owner}` : kind;

  return (
    <li className={`search-pick is-${hit.kind}`}>
      <button
        type="button"
        className="search-pick-main"
        onClick={onOpen}
        aria-label={hit.kind === "tracks" ? t("search.play", { name }) : t("search.open", { name })}
      >
        <AlbumArt title={name} image={cover} size="small" />
        <span>
          <strong title={name}>{name}</strong>
          <small title={detail}>{detail}</small>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          className="search-pick-remove"
          onClick={onRemove}
          aria-label={t("search.removeHistory", { query: name })}
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}
