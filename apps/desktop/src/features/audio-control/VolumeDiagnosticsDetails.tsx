import { Activity } from "lucide-react";
import { t } from "../../i18n";
import { useVolumeDiagnostics } from "./audioControl";

/** Collapsible latency and sync readout of the volume pipeline. */
export function VolumeDiagnosticsDetails() {
  const diagnostics = useVolumeDiagnostics();
  const { lastIntent, lastFinalCommit } = diagnostics;
  const rows: Array<[string, string]> = [
    [t("audio.diag.lastIntent"), lastIntent
      ? `#${lastIntent.sequence} · UI ${Math.round(lastIntent.uiTarget * 100)}% · Spotify ${Math.round(lastIntent.spotifyTarget * 100)}%${lastIntent.final ? " · final" : ""}`
      : t("audio.diag.none")],
    [t("audio.diag.uiToCoordinator"), formatLatency(diagnostics.uiToCoordinatorLatencyMs)],
    [t("audio.diag.coordinatorWait"), formatLatency(diagnostics.coordinatorWaitLatencyMs)],
    [t("audio.diag.coordinatorToRust"), formatLatency(diagnostics.coordinatorToRustLatencyMs)],
    [t("audio.diag.total"), formatLatency(diagnostics.lastConfirmationLatencyMs)],
    [t("audio.diag.preview"), t(diagnostics.livePreviewActive ? "audio.diag.previewActive" : "audio.diag.previewReady", { interval: diagnostics.previewIntervalMs })],
    [t("audio.diag.previewSent"), String(diagnostics.sentPreviewValues)],
    [t("audio.diag.previewDropped"), String(diagnostics.droppedPreviewValues)],
    [t("audio.diag.lastFinal"), lastFinalCommit ? `#${lastFinalCommit.sequence} · ${Math.round(lastFinalCommit.uiTarget * 100)}%` : t("audio.diag.none")],
    [t("audio.diag.confirmed"), diagnostics.confirmedSpotifyValue === undefined ? "—" : `${Math.round(diagnostics.confirmedSpotifyValue * 1000) / 10}%`],
    [t("audio.diag.mismatch"), diagnostics.lastMismatchDifference === undefined ? "—" : diagnostics.lastMismatchDifference.toFixed(4)],
    [t("audio.diag.request"), diagnostics.activeRequestId ?? t("audio.diag.requestNone")],
    [t("audio.diag.curve"), lastIntent?.curve === "perceptual" ? t("audio.page.curvePerceptual") : t("audio.diag.curveLinear")],
    [t("audio.diag.adapter"), diagnostics.adapter],
    [t("audio.diag.volumeEvent"), t(diagnostics.volumeEventAvailable ? "audio.diag.eventAvailable" : "audio.diag.eventUnconfirmed")],
    [t("audio.diag.resync"), diagnostics.lastResyncReason],
  ];

  return (
    <details className="audio-diagnostics-details">
      <summary><Activity size={16} /><span>{t("audio.page.diagnostics")}</span></summary>
      <dl className="audio-diagnostic-grid">
        {rows.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </details>
  );
}

function formatLatency(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value)} ms`;
}
