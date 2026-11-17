import { Check, CircleAlert, LoaderCircle, Radio, Speaker, Users, Waves, type LucideIcon } from "lucide-react";

import { t, type MessageKey } from "../../i18n";
import type { LibrespotPhase } from "../../types/tauri";
import { listenConnectionLabelKey } from "./diagnosticState";
import type { DiagnosticsContext } from "./useDiagnostics";

export function DiagnosticOverview({ context }: { context: DiagnosticsContext }) {
  const { state, libre, settings, listen, mockMode } = context;
  const phase = libre?.phase;
  const sessionTone = state.status === "ok" || state.status === "demo" ? "ok" : state.status === "checking" ? "pending" : "warning";
  return (
    <div className="diagnostic-grid">
      <DiagnosticCard
        icon={Radio}
        tone="neutral"
        title={t("diagnostics.engine")}
        value={mockMode ? t("diagnostics.demo") : "Librespot"}
        detail={mockMode ? t("diagnostics.demoHint") : t("diagnostics.direct")}
      />
      <DiagnosticCard
        icon={Waves}
        tone={sessionTone}
        title={t("diagnostics.session")}
        value={mockMode ? t("diagnostics.healthy") : t(phaseLabelKey(phase))}
        detail={mockMode ? t("diagnostics.demoHint") : t(phaseHintKey(phase, state.status))}
      />
      <DiagnosticCard
        icon={Speaker}
        tone="neutral"
        title={t("diagnostics.output")}
        value={settings?.librespotAudioDevice?.trim() || t("diagnostics.defaultDevice")}
        detail={t("diagnostics.outputHint")}
      />
      <DiagnosticCard
        icon={Users}
        tone={listen?.connection === "online" ? "ok" : "neutral"}
        title={t("diagnostics.listen")}
        value={t(listenConnectionLabelKey(listen))}
        detail={listen?.serverUrl ? listen.serverUrl : t("diagnostics.listenHint")}
      />
    </div>
  );
}

function DiagnosticCard({
  icon: Icon,
  tone,
  title,
  value,
  detail,
}: {
  icon: LucideIcon;
  tone: "ok" | "warning" | "pending" | "neutral";
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="diagnostic-card">
      <span className={`diagnostic-icon ${tone}`} aria-hidden="true"><Icon /></span>
      <div className="diagnostic-card-body">
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {tone === "ok" && <Check className="diagnostic-check" aria-hidden="true" />}
      {tone === "warning" && <CircleAlert className="diagnostic-warning" aria-hidden="true" />}
      {tone === "pending" && <LoaderCircle className="diagnostic-check is-spinning" aria-hidden="true" />}
    </div>
  );
}

export function phaseLabelKey(phase: LibrespotPhase | undefined): MessageKey {
  switch (phase) {
    case "ready":
      return "diagnostics.connected";
    case "connecting":
      return "diagnostics.connecting";
    case "authenticating":
      return "diagnostics.authenticating";
    case "needsLogin":
      return "diagnostics.needsLogin";
    case "error":
      return "diagnostics.error";
    case "disconnected":
      return "diagnostics.offline";
    default:
      return "diagnostics.pending";
  }
}

function phaseHintKey(phase: LibrespotPhase | undefined, status: DiagnosticsContext["state"]["status"]): MessageKey {
  if (status === "unknown") return "diagnostics.retryHint";
  switch (phase) {
    case "ready":
      return "diagnostics.libreReady";
    case "needsLogin":
      return "diagnostics.libreLoginHint";
    case "authenticating":
      return "diagnostics.libreAuthHint";
    case "connecting":
      return "diagnostics.libreConnectingHint";
    case "error":
      return "diagnostics.libreErrorHint";
    default:
      return "diagnostics.libreOfflineHint";
  }
}
