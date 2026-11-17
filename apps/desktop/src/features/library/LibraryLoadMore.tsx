import { t } from "../../i18n";

interface LibraryLoadMoreProps {
  pending: boolean;
  onClick: () => void;
}

export function LibraryLoadMore({ pending, onClick }: LibraryLoadMoreProps) {
  return (
    <div className="library-load-more-row">
      <button
        type="button"
        className="secondary-button load-more"
        disabled={pending}
        onClick={onClick}
      >
        {pending ? t("libraryUi.loadingMore") : t("libraryUi.loadMore")}
      </button>
    </div>
  );
}
