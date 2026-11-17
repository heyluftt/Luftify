import { Copy, FileDown, FolderOpen, LoaderCircle, LogIn, RefreshCw, Settings2, Wrench } from "lucide-react";
import { Link } from "react-router-dom";

import { t } from "../../i18n";
import type { DiagnosticsContext } from "./useDiagnostics";

export function DiagnosticActions({ context }: { context: DiagnosticsContext }) {
  const { state, mockMode, connect, connecting, connectError, exportReport, exporting, exportResult, exportError, revealReport, copyPath, pathCopied } = context;
  const showConnect = !mockMode && (state.needsLogin || state.canReconnect);
  return (
    <section className="diagnostic-workspace">
      <div className="diagnostic-actions">
        <div className="diagnostic-section-heading">
          <span className="diagnostic-section-icon"><Wrench aria-hidden="true" /></span>
          <div>
            <h2>{t("diagnostics.playback")}</h2>
            <p>{t("diagnostics.snapshotHint")}</p>
          </div>
        </div>
        <div className="diagnostic-button-row">
          {showConnect && (
            <button type="button" className="secondary-button" disabled={connecting} onClick={connect}>
              {connecting ? <LoaderCircle className="is-spinning" size={16} /> : state.needsLogin ? <LogIn size={16} /> : <RefreshCw size={16} />}
              {connecting ? t("diagnostics.connectingLibre") : state.needsLogin ? t("diagnostics.loginLibre") : t("diagnostics.connectLibre")}
            </button>
          )}
          <Link className="secondary-button" to="/settings?focus=playback">
            <Settings2 size={16} />{t("diagnostics.settings")}
          </Link>
        </div>
        {connectError && <p className="diagnostic-error-copy" role="alert">{connectError}</p>}
      </div>

      <div className="diagnostic-actions">
        <div className="diagnostic-section-heading">
          <span className="diagnostic-section-icon"><FileDown aria-hidden="true" /></span>
          <div>
            <h2>{t("diagnostics.report")}</h2>
            <p>{t("diagnostics.reportHint")}</p>
          </div>
        </div>
        <div className="diagnostic-button-row">
          <button type="button" className="secondary-button" disabled={exporting} onClick={exportReport}>
            {exporting ? <LoaderCircle className="is-spinning" size={16} /> : <FileDown size={16} />}
            {exporting ? t("diagnostics.exporting") : t("diagnostics.export")}
          </button>
        </div>
        {exportError && <p className="diagnostic-error-copy" role="alert">{t("diagnostics.actionError")}</p>}
        {exportResult && (
          <div className="diagnostic-report-result">
            <p className="diagnostic-report-title">{t("diagnostics.saved")}</p>
            <p className={`diagnostic-report-counts${exportResult.warnings + exportResult.errors > 0 ? " has-issues" : ""}`}>
              {exportResult.warnings + exportResult.errors > 0
                ? t("diagnostics.reportCounts", { warnings: exportResult.warnings, errors: exportResult.errors })
                : t("diagnostics.reportClean")}
            </p>
            <code className="diagnostic-report-path">{exportResult.path}</code>
            <div className="diagnostic-report-actions">
              <button type="button" className="secondary-button" onClick={() => revealReport(exportResult.path)}>
                <FolderOpen size={16} />{t("diagnostics.revealReport")}
              </button>
              <button type="button" className="secondary-button" onClick={() => copyPath(exportResult.path)}>
                <Copy size={16} />{pathCopied ? t("diagnostics.pathCopied") : t("diagnostics.copyPath")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
