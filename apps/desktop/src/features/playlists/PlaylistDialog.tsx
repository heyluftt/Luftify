import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { useModalDialog } from "../friends/profile/useModalDialog";

/** The frame the playlist dialogs share: title, close, content. */
export function PlaylistDialog({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLElement>(null);
  useModalDialog(dialog, onClose);
  return createPortal(<div className="friend-profile-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="playlist-dialog" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
      <header>
        <h2 id={id}>{title}</h2>
        <button type="button" className="friends-icon-button" onClick={onClose} title={t("playlists.close")} aria-label={t("playlists.close")}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {children}
    </section>
  </div>, document.body);
}
