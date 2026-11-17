import { Bell, BellOff, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../../i18n";
import { playedAgo } from "../friends/profile/friendsTime";
import { useFriends } from "../friends/useFriends";
import { NoticeFace } from "./NoticeFace";
import { unreadCount, useNotices, type NoticeEntry } from "./noticeStore";

/**
 * The bell in the top bar: everything since start, also what "Do not
 * disturb" kept quiet. Opening it marks all as read.
 */
export function NoticeCenter() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const history = useNotices((state) => state.history);
  const unread = useNotices(unreadCount);
  const markRead = useNotices((state) => state.markRead);
  const clear = useNotices((state) => state.clearHistory);
  const snapshot = useFriends().data?.snapshot;
  const quiet = snapshot?.options.presenceMode === "busy";

  useEffect(() => {
    if (!open) return;
    markRead();
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open, markRead, history.length]);

  const label = unread ? t("notice.centerUnread", { n: unread }) : t("notice.center");
  return <div className="topbar-history notice-center" ref={root}>
    <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}>
      {quiet ? <BellOff size={17} /> : <Bell size={17} />}
      {unread > 0 && <span className="notice-center-count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
    </button>
    {open && <section className="notice-center-panel" role="dialog" aria-label={t("notice.center")}>
      <header>
        <h2>{t("notice.center")}</h2>
        {history.length > 0 && <button type="button" className="text-button" onClick={clear}>{t("notice.clear")}</button>}
        <Link className="friends-icon-button" to="/settings?focus=notifications" onClick={() => setOpen(false)}
          title={t("settingsUi.nav.notifications")} aria-label={t("settingsUi.nav.notifications")}><Settings2 size={15} aria-hidden="true" /></Link>
      </header>
      {quiet && <p className="notice-center-quiet"><BellOff size={13} aria-hidden="true" />{t("notice.quiet")}</p>}
      {history.length
        ? <ul>{history.map((entry) => <NoticeRow key={entry.id} entry={entry} onOpen={() => setOpen(false)} />)}</ul>
        : <p className="notice-center-empty">{t("notice.empty")}</p>}
    </section>}
  </div>;
}

function NoticeRow({ entry, onOpen }: { entry: NoticeEntry; onOpen: () => void }) {
  // An invitation that ran out keeps its line but loses the way in.
  const action = entry.untilMs && entry.untilMs < Date.now() ? undefined : entry.action;
  const body = <>
    <NoticeFace notice={entry} />
    <span><strong>{entry.title}</strong><small>{playedAgo(entry.atMs)}</small></span>
  </>;
  return <li data-kind={entry.kind}>
    {action ? <Link to={action.to} onClick={onOpen}>{body}</Link> : <div>{body}</div>}
  </li>;
}
