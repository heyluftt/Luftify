import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { MessageSquareWarning, X } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n";
import { useFriends } from "../friends/useFriends";
import { canReport, problemReportApi } from "./problemReportApi";
import { ProblemReportDialog } from "./ProblemReportDialog";

const QUERY_KEY = ["previous-session"] as const;

/** After a crash or a hang: offer "Report a problem" once, with the facts in the diagnostics. */
export function CrashPrompt() {
  const client = useQueryClient();
  const friends = useFriends();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const previous = useQuery({ queryKey: QUERY_KEY, queryFn: problemReportApi.previousSession, enabled: isTauri(), staleTime: Infinity, retry: false });
  const session = previous.data;
  const reachable = friends.data?.connection === "online" && canReport(friends.data.snapshot);
  if (!session || !reachable) return null;
  const hang = session.cause === "hang";
  const dismiss = () => {
    client.setQueryData(QUERY_KEY, null);
    void problemReportApi.dismissPreviousSession().catch(() => undefined);
  };
  if (open) {
    // Dismissed on closing, so the dialog can still say thanks.
    return <ProblemReportDialog initialMessage={t(hang ? "crash.messageHang" : "crash.message")}
      onClose={() => { setOpen(false); if (sent) dismiss(); }} onSent={() => setSent(true)} />;
  }
  return <aside className="app-notice" data-kind="report" role="status">
    <span className="app-notice-icon" aria-hidden="true"><MessageSquareWarning size={17} /></span>
    <strong>{t(hang ? "crash.titleHang" : "crash.title")}</strong>
    <button type="button" className="secondary-button" onClick={() => setOpen(true)}>{t("report.title")}</button>
    <button type="button" className="friends-icon-button" onClick={dismiss} title={t("update.close")} aria-label={t("update.close")}>
      <X size={15} aria-hidden="true" />
    </button>
  </aside>;
}
