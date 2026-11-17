import { X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { t } from "../../i18n";
import { NoticeFace } from "./NoticeFace";
import { useNotices, type AppNotice } from "./noticeStore";

const SHOWN_MS = 6_000;

/**
 * One notice. A thin line runs down while it shows; pointer or keyboard
 * focus on the card holds it (and a minimised window pauses it), invitations
 * run until they expire. Closing slides it out.
 */
export function NoticeCard({ notice }: { notice: AppNotice }) {
  const dismiss = useNotices((state) => state.dismiss);
  const [ms] = useState(() => Math.max(800, notice.untilMs ? notice.untilMs - Date.now() : SHOWN_MS));
  const [leaving, setLeaving] = useState(false);
  const leave = () => setLeaving(true);
  return <aside className="app-notice" data-kind={notice.kind} data-leaving={leaving || undefined} role="status"
    style={{ "--notice-ms": `${ms}ms` } as CSSProperties}
    onAnimationEnd={(event) => { if (leaving && event.target === event.currentTarget) dismiss(notice.id); }}>
    <NoticeFace notice={notice} />
    <strong>{notice.title}</strong>
    {notice.action && <Link className="secondary-button" to={notice.action.to} onClick={leave}>{notice.action.label}</Link>}
    <button type="button" className="friends-icon-button" onClick={leave} title={t("update.close")} aria-label={t("update.close")}>
      <X size={15} aria-hidden="true" />
    </button>
    <i className="app-notice-timer" aria-hidden="true" onAnimationEnd={(event) => { event.stopPropagation(); leave(); }} />
  </aside>;
}
