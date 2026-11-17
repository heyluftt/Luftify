import { ChevronRight } from "lucide-react";
import { t } from "../../i18n";

export function SearchSectionHeading({
  id,
  title,
  count,
  onShowAll,
}: {
  id: string;
  title: string;
  count?: number | undefined;
  onShowAll?: (() => void) | undefined;
}) {
  return (
    <header className="search-section-heading">
      <h2 id={id}>{title}</h2>
      {onShowAll ? (
        <button type="button" className="search-show-all" onClick={onShowAll} aria-describedby={id}>
          {t("search.showAll")}
          {count !== undefined && <small>{count}</small>}
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      ) : (
        count !== undefined && <span>{count}</span>
      )}
    </header>
  );
}
