import {
  AlertCircle,
  LoaderCircle,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { t } from "../../i18n";

type SearchFeedbackProps = {
  connecting: boolean;
  capabilityMissing: boolean;
  searchReady: boolean;
  loading: boolean;
  hasData: boolean;
  error: boolean;
  onRetry: () => void;
};

export function SearchFeedback({
  connecting,
  capabilityMissing,
  searchReady,
  loading,
  hasData,
  error,
  onRetry,
}: SearchFeedbackProps) {
  if (connecting) {
    return (
      <div className="search-inline-status" role="status">
        <LoaderCircle className="spin" size={16} />
        <span>
          {t("search.connecting")}
        </span>
      </div>
    );
  }

  if (capabilityMissing) {
    return (
      <div className="search-message error" role="alert">
        <span className="search-message-icon">
          <WifiOff size={20} aria-hidden="true" />
        </span>

        <div>
          <strong>{t("search.unavailable")}</strong>
          <p>{t("search.unavailableHint")}</p>
        </div>

        <button type="button" onClick={onRetry}>
          <RefreshCw size={15} />
          {t("search.reconnect")}
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="search-message error" role="alert">
        <span className="search-message-icon">
          <AlertCircle size={20} aria-hidden="true" />
        </span>

        <div>
          <strong>{t("search.failed")}</strong>
        </div>

        <button type="button" onClick={onRetry}>
          <RefreshCw size={15} />
          {t("search.retry")}
        </button>
      </div>
    );
  }

  if (searchReady && loading && !hasData) {
    return <SearchLoadingState />;
  }

  return null;
}

function SearchLoadingState() {
  return (
    <div
      className="search-loading-state"
      role="status"
      aria-label={t("search.loadingAria")}
    >
      <span className="search-loading-label">
        <LoaderCircle className="spin" size={15} />
        {t("search.loading")}
      </span>

      <div className="search-loading-rows" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index}>
            <i />
            <b />
            <em />
          </span>
        ))}
      </div>

      <div className="search-loading-cards" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  );
}
