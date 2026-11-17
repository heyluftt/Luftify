import { SearchX } from "lucide-react";
import { t } from "../../i18n";

type SearchNoResultsProps = {
  query: string;
  partialUnavailable?: boolean;
};

export function SearchNoResults({
  query,
  partialUnavailable = false,
}: SearchNoResultsProps) {
  return (
    <div className="search-no-results">
      <span>
        <SearchX size={22} aria-hidden="true" />
      </span>

      <div>
        <h2>{t("search.noResults", { query })}</h2>
        <p>
          {partialUnavailable
            ? t("search.noResultsPartial")
            : t("search.noResultsHint")}
        </p>
      </div>
    </div>
  );
}
