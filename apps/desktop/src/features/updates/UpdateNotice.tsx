import { ArrowDownToLine, Sparkles, X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { appLanguage, t, type MessageKey } from "../../i18n";
import { BUNDLED_NOTES, pickNotes } from "./releaseNotes";
import { ReleaseHistoryDialog } from "./ReleaseHistoryDialog";
import { openUpdatePage, progressPercent, updateErrorKey, useAppUpdate, type UpdateProgress } from "./useAppUpdate";
import { markSeen, postpone, postponedUntil, seenVersion } from "./updateMemory";

const megabytes = new Intl.NumberFormat(appLanguage(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function downloadText(progress: UpdateProgress | null): string {
  const percent = progressPercent(progress);
  if (percent === 100) return t("update.restarting");
  if (!progress?.total) return t("update.downloading", { n: percent ?? 0 });
  return t("update.downloadingSize", {
    n: percent ?? 0,
    done: megabytes.format(progress.downloaded / 1_048_576),
    total: megabytes.format(progress.total / 1_048_576),
  });
}

function NoteList({ lines }: { lines: string[] }) {
  return lines.length ? <ul className="update-notes">{lines.map((line) => <li key={line}>{line}</li>)}</ul> : null;
}

/**
 * Bottom right: a new version with what is new in it, or once after an update
 * what the installed version brought.
 */
export function UpdateNotice() {
  const { query, install, progress } = useAppUpdate(true);
  const [later, setLater] = useState(0);
  const whatsNew = useWhatsNew();
  const [history, setHistory] = useState(false);
  const version = query.data?.version;
  const hiddenUntil = version ? Math.max(later, postponedUntil(version)) : 0;

  if (version && (install.isPending || hiddenUntil <= Date.now())) {
    const lines = pickNotes(query.data?.notes, query.data?.notesEn);
    const manual = query.data?.manual === true;
    return <aside className="update-notice" role="status" aria-labelledby="update-notice-title">
      <header>
        <span className="update-notice-icon" aria-hidden="true"><ArrowDownToLine size={18} /></span>
        <div className="update-notice-copy">
          <strong id="update-notice-title">{t("update.available", { version })}</strong>
          {install.isPending
            ? <small>{downloadText(progress)}</small>
            : install.isError ? <small role="alert" data-error="true">{t(updateErrorKey(install.error) as MessageKey)}</small>
            : <small>{t(manual ? "update.manualHint" : "update.hint")}</small>}
        </div>
      </header>
      {install.isPending
        ? <span className="update-notice-bar" aria-hidden="true"><i style={{ width: `${progressPercent(progress) ?? 4}%` }} /></span>
        : <>
          <NoteList lines={lines} />
          <div className="update-notice-actions">
            <button type="button" className="secondary-button" onClick={() => setLater(postpone(version))}>{t("update.later")}</button>
            {manual
              ? <button type="button" className="primary-button" onClick={() => void openUpdatePage()}>{t("update.download")}</button>
              : <button type="button" className="primary-button" onClick={() => install.mutate()}>{t(install.isError ? "update.retry" : "update.install")}</button>}
          </div>
        </>}
    </aside>;
  }

  if (history) return <ReleaseHistoryDialog onClose={() => setHistory(false)} />;
  if (!whatsNew.open) return null;
  return <aside className="update-notice" role="status" aria-labelledby="update-notice-title">
    <header>
      <span className="update-notice-icon" aria-hidden="true"><Sparkles size={18} /></span>
      <div className="update-notice-copy">
        <strong id="update-notice-title">{t("update.whatsNew", { version: BUNDLED_NOTES.version ?? "" })}</strong>
      </div>
      <button type="button" className="friends-icon-button" onClick={whatsNew.close} title={t("update.close")} aria-label={t("update.close")}>
        <X size={16} aria-hidden="true" />
      </button>
    </header>
    <NoteList lines={BUNDLED_NOTES.lines} />
    <div className="update-notice-actions">
      <button type="button" className="text-button" onClick={() => { setHistory(true); whatsNew.close(); }}>{t("update.historyAll")}</button>
    </div>
  </aside>;
}

/** Once per version, a moment after start, when this build has notes. */
function useWhatsNew() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const version = BUNDLED_NOTES.version;
    if (!isTauri() || import.meta.env.DEV || !version || !BUNDLED_NOTES.lines.length || seenVersion() === version) return;
    const timer = window.setTimeout(() => { markSeen(version); setOpen(true); }, 2500);
    return () => window.clearTimeout(timer);
  }, []);
  return { open, close: () => setOpen(false) };
}
