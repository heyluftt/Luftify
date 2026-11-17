import { t } from "../../i18n";

interface LoadMoreProps {
  pending: boolean;
  onClick: () => void;
}

export function LoadMore({ pending, onClick }: LoadMoreProps) {
  return (
    <button
      type="button"
      className="secondary-button load-more"
      disabled={pending}
      onClick={onClick}
    >
      {t(pending ? "shell.loadingMore" : "shell.loadMore")}
    </button>
  );
}
