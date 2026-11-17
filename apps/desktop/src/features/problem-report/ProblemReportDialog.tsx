import { Check, X } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t, type MessageKey } from "../../i18n";
import { friendsErrorText } from "../friends/useFriends";
import { useModalDialog } from "../friends/profile/useModalDialog";
import { MAX_REPORT_MESSAGE, problemReportApi, reportErrorKey } from "./problemReportApi";

/** A short description, optionally the masked diagnostics, viewable before sending. */
export function ProblemReportDialog({ initialMessage = "", onClose, onSent }: { initialMessage?: string; onClose: () => void; onSent?: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useModalDialog(dialog, onClose);
  const [message, setMessage] = useState(initialMessage);
  const [details, setDetails] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const preview = useQuery({ queryKey: ["problem-report-preview"], queryFn: problemReportApi.preview, enabled: showDetails, staleTime: 0, gcTime: 0, retry: false });
  const send = useMutation({ mutationFn: () => problemReportApi.send(message, details), onSuccess: () => onSent?.() });
  const errorKey = send.isError ? reportErrorKey(send.error) : null;
  const text = useRef<HTMLTextAreaElement>(null);
  // After the dialog has taken focus itself (see useModalDialog).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const field = text.current;
      // A prefilled text continues where it ends.
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
    }, 60);
    return () => window.clearTimeout(timer);
  }, []);

  return createPortal(<div className="friend-profile-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="problem-report" role="dialog" aria-modal="true" aria-labelledby="problem-report-title" tabIndex={-1}>
      <header>
        <h2 id="problem-report-title">{t("report.title")}</h2>
        <button type="button" className="friends-icon-button" onClick={onClose} title={t("update.close")} aria-label={t("update.close")}><X size={18} aria-hidden="true" /></button>
      </header>
      {send.isSuccess
        ? <div className="problem-report-sent" role="status">
          <span aria-hidden="true"><Check size={22} /></span>
          <strong>{t("report.sent")}</strong>
          <button type="button" className="secondary-button" onClick={onClose}>{t("update.close")}</button>
        </div>
        : <form onSubmit={(event) => { event.preventDefault(); if (message.trim() && !send.isPending) send.mutate(); }}>
          <label htmlFor="problem-report-message">{t("report.message")}</label>
          <textarea ref={text} id="problem-report-message" value={message} maxLength={MAX_REPORT_MESSAGE} rows={5}
            placeholder={t("report.placeholder")} disabled={send.isPending} onChange={(event) => setMessage(event.currentTarget.value)} />
          <small>{t("report.left", { n: MAX_REPORT_MESSAGE - message.length })}</small>

          <div className="problem-report-details">
            <label className="own-profile-toggle">
              <strong>{t("report.details")}</strong>
              <span className="switch"><input type="checkbox" checked={details} disabled={send.isPending}
                onChange={(event) => setDetails(event.currentTarget.checked)} /><span /></span>
            </label>
            {details && <>
              <div className="problem-report-details-row">
                <small>{t("report.detailsPrivacy")}</small>
                <button type="button" className="text-button" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>
                  {t(showDetails ? "report.detailsHide" : "report.detailsShow")}
                </button>
              </div>
              {showDetails && <pre className="problem-report-preview">{preview.data ?? (preview.isError ? friendsErrorText(preview.error) : t("report.detailsLoading"))}</pre>}
            </>}
          </div>

          {errorKey && <small className="friends-inline-error" role="alert">
            {errorKey.startsWith("report.") ? t(errorKey as MessageKey) : friendsErrorText(errorKey)}
          </small>}
          <div className="problem-report-actions">
            <button type="button" className="secondary-button" disabled={send.isPending} onClick={onClose}>{t("friends.cancel")}</button>
            <button type="submit" className="primary-button" disabled={send.isPending || !message.trim()}>
              {t(send.isPending ? "report.sending" : "report.send")}
            </button>
          </div>
        </form>}
    </section>
  </div>, document.body);
}
