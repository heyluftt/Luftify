import { BarChart3, RefreshCw, ShieldOff } from "lucide-react";
import { Link } from "react-router-dom";
import { t } from "../../i18n";

export function AnalyticsLoadingState() {
  return (
    <div className="analytics-loading" aria-label={t("analytics.loading")}>
      <span /><span /><span />
    </div>
  );
}

export function AnalyticsEmptyState() {
  return (
    <div className="analytics-state">
      <BarChart3 aria-hidden="true" />
      <h2>{t("analytics.empty")}</h2>
    </div>
  );
}

export function AnalyticsDisabledState() {
  return (
    <div className="analytics-state">
      <ShieldOff aria-hidden="true" />
      <h2>{t("analytics.disabled")}</h2>
      <Link className="secondary-button" to="/settings">{t("nav.settings")}</Link>
    </div>
  );
}

export function AnalyticsErrorState({ retry }: { retry: () => void }) {
  return (
    <div className="analytics-state">
      <BarChart3 aria-hidden="true" />
      <h2>{t("analytics.unavailable")}</h2>
      <button type="button" className="secondary-button" onClick={retry}>
        <RefreshCw size={15} aria-hidden="true" />
        {t("miniplayer.retry")}
      </button>
    </div>
  );
}
