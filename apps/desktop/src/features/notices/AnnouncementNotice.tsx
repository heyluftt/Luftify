import { Megaphone, X } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n";
import { useFriends } from "../friends/useFriends";

const SEEN_KEY = "luftify.announcement.dismissed";

function dismissed(): string | null {
  try { return window.localStorage.getItem(SEEN_KEY); } catch { return null; }
}

/** Luft's line for everyone; closing it hides this text until a new one comes. */
export function AnnouncementNotice() {
  const text = useFriends().data?.snapshot?.announcement ?? null;
  const [closed, setClosed] = useState(dismissed);
  if (!text || closed === text) return null;
  const close = () => {
    setClosed(text);
    try { window.localStorage.setItem(SEEN_KEY, text); } catch { /* Only a convenience. */ }
  };
  return <aside className="app-notice app-announcement" data-kind="announcement" role="status">
    <span className="app-notice-icon" aria-hidden="true"><Megaphone size={17} /></span>
    <strong><small>{t("announcement.title")}</small>{text}</strong>
    <button type="button" className="friends-icon-button" onClick={close} title={t("update.close")} aria-label={t("update.close")}>
      <X size={15} aria-hidden="true" />
    </button>
  </aside>;
}
