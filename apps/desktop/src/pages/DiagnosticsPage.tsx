import { Activity, AlertTriangle, RefreshCw } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { t } from "../i18n";
import { useDiagnostics } from "../features/diagnostics/useDiagnostics";
import { DiagnosticOverview } from "../features/diagnostics/DiagnosticOverview";
import { DiagnosticActions } from "../features/diagnostics/DiagnosticActions";
import { DiagnosticCapabilities } from "../features/diagnostics/DiagnosticCapabilities";
import { LosslessProbe } from "../features/diagnostics/LosslessProbe";
import { isLibrespotPlaybackReady } from "../features/spotify/librespotCapabilities";

export function DiagnosticsPage() {
  const context = useDiagnostics();
  const { activeError, refreshing, badgeState, badgeLabel, refreshAll, libre } = context;

  return (
    <div className="page diagnostics-page">
      <div className="page-heading split">
        <div>
          <span className="diagnostics-eyebrow"><Activity size={14} /> {t("diagnostics.systemCheck")}</span>
          <h1>{t("diagnostics.title")}</h1>
          <p>{t("diagnostics.subtitle")}</p>
        </div>
        <div className="diagnostics-heading-actions">
          <StatusBadge state={badgeState} label={badgeLabel} />
          <button
            type="button"
            className="diagnostic-refresh-button"
            disabled={refreshing}
            onClick={refreshAll}
            title={t("diagnostics.refresh")}
            aria-label={t("diagnostics.refresh")}
          >
            <RefreshCw className={refreshing ? "is-spinning" : undefined} />
          </button>
        </div>
      </div>

      {activeError && (
        <div className="diagnostic-page-alert" role="alert">
          <AlertTriangle />
          <span><strong>{t("diagnostics.unreachable")}</strong><small>{t("diagnostics.retryShort")}</small></span>
          <button type="button" disabled={refreshing} onClick={refreshAll}>{t("diagnostics.retry")}</button>
        </div>
      )}

      <DiagnosticOverview context={context} />

      <DiagnosticActions context={context} />

      <DiagnosticCapabilities context={context} />

      {isLibrespotPlaybackReady(libre?.phase) && <LosslessProbe />}
    </div>
  );
}
