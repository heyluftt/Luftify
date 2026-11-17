import { Check, ChevronDown, ClipboardCopy, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { t } from "../../i18n";
import { playedAgo } from "../friends/profile/friendsTime";
import { friendsErrorText } from "../friends/useFriends";
import { REPORTS_QUERY_KEY, problemReportApi, type ProblemReportSummary } from "./problemReportApi";

/** Luft's list of reported problems; "done" deletes one on the server. */
export function ProblemReportsInbox({ disabled }: { disabled: boolean }) {
  const reports = useQuery({ queryKey: REPORTS_QUERY_KEY, queryFn: problemReportApi.list, enabled: !disabled, staleTime: 60_000, retry: false });
  const list = reports.data ?? [];
  return <div className="report-inbox">
    <div className="report-inbox-heading">
      <h3>{t("report.inbox")}{list.length > 0 && <span className="friends-count">{list.length}</span>}</h3>
      <button type="button" className="friends-icon-button" disabled={disabled || reports.isFetching} onClick={() => void reports.refetch()}
        title={t("report.inboxRefresh")} aria-label={t("report.inboxRefresh")}><RefreshCw size={15} aria-hidden="true" /></button>
    </div>
    {reports.isError && <small className="friends-inline-error" role="alert">{friendsErrorText(reports.error)}</small>}
    {!reports.isError && reports.isSuccess && !list.length && <p className="report-inbox-empty">{t("report.inboxEmpty")}</p>}
    {list.length > 0 && <ul>{list.map((report) => <ReportItem key={report.id} report={report} disabled={disabled} />)}</ul>}
  </div>;
}

function ReportItem({ report, disabled }: { report: ProblemReportSummary; disabled: boolean }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const full = useQuery({ queryKey: [...REPORTS_QUERY_KEY, report.id], queryFn: () => problemReportApi.get(report.id), enabled: open && report.hasDiagnostics, staleTime: Infinity, retry: false });
  const done = useMutation({
    mutationFn: () => problemReportApi.remove(report.id),
    onSuccess: () => client.setQueryData<ProblemReportSummary[]>(REPORTS_QUERY_KEY, (list) => list?.filter((entry) => entry.id !== report.id)),
  });
  const details = full.data?.diagnostics ? pretty(full.data.diagnostics) : null;
  return <li className="report-item">
    <div className="report-item-head">
      <strong>{report.reporterName}</strong>
      <small>{playedAgo(report.createdAtMs)} · {report.appVersion}</small>
      <button type="button" className="secondary-button" disabled={disabled || done.isPending} onClick={() => done.mutate()}>
        <Check size={14} aria-hidden="true" />{t("report.inboxDone")}
      </button>
    </div>
    <p>{report.message}</p>
    {report.hasDiagnostics
      ? <button type="button" className="text-button report-item-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={14} aria-hidden="true" />{t("report.inboxDetails")}
      </button>
      : <small className="report-item-none">{t("report.inboxNoDetails")}</small>}
    {open && <div className="report-item-details">
      {details && <button type="button" className="friends-icon-button" title={t(copied ? "report.inboxCopied" : "report.inboxCopy")} aria-label={t(copied ? "report.inboxCopied" : "report.inboxCopy")}
        onClick={async () => { try { await navigator.clipboard.writeText(details); setCopied(true); } catch { setCopied(false); } }}>
        {copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}
      </button>}
      <pre className="problem-report-preview">{details ?? (full.isError ? friendsErrorText(full.error) : t("report.detailsLoading"))}</pre>
    </div>}
    {done.isError && <small className="friends-inline-error" role="alert">{friendsErrorText(done.error)}</small>}
  </li>;
}

function pretty(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}
