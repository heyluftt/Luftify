import { useEffect } from "react";
import { t } from "../../i18n";

const UNDO_WINDOW_MS = 8_000;

export function MixUndoNotice({ title, onUndo, onDismiss }: {
  title: string; onUndo: () => void; onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [title, onDismiss]);
  return <div className="mix-undo" role="status">
    <span>{t("discovery.removed", { title })}</span>
    <button type="button" className="ghost-button" onClick={onUndo}>{t("discovery.undo")}</button>
  </div>;
}
