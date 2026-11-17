import { X } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { useModalDialog } from "../friends/profile/useModalDialog";
import { BUNDLED_NOTES, releaseHistory } from "./releaseNotes";
import "../../styles/components/release-history.css";

/** What came with each version, newest first; opened from the settings. */
export function ReleaseHistoryDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useModalDialog(dialog, onClose);
  const history = releaseHistory();
  return createPortal(<div className="friend-profile-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="release-history" role="dialog" aria-modal="true" aria-labelledby="release-history-title" tabIndex={-1}>
      <header>
        <h2 id="release-history-title">{t("update.history")}</h2>
        <button type="button" className="friends-icon-button" onClick={onClose} title={t("update.close")} aria-label={t("update.close")}><X size={18} aria-hidden="true" /></button>
      </header>
      <ol className="release-history-list">
        {history.map((section) => <li key={section.version} data-current={section.version === BUNDLED_NOTES.version || undefined}>
          <h3>{section.version}{section.version === BUNDLED_NOTES.version && <span>{t("update.installed")}</span>}</h3>
          <ul>{section.lines.map((line) => <li key={line}>{line}</li>)}</ul>
        </li>)}
      </ol>
    </section>
  </div>, document.body);
}
