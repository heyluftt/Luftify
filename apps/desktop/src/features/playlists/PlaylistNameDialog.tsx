import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { PlaylistDialog } from "./PlaylistDialog";

const MAX_NAME = 100;

/** A name for a new playlist (with "collaborative" right away) or a new one for an existing playlist. */
export function PlaylistNameDialog({ initialName = "", creating, pending, failed, onSubmit, onClose }: {
  initialName?: string;
  creating: boolean;
  pending: boolean;
  failed: boolean;
  onSubmit: (name: string, collaborative: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [collaborative, setCollaborative] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // After the dialog has taken focus itself (see useModalDialog).
  useEffect(() => {
    const timer = window.setTimeout(() => field.current?.select(), 60);
    return () => window.clearTimeout(timer);
  }, []);
  const trimmed = name.trim();
  return <PlaylistDialog id="playlist-name-title" title={t(creating ? "playlists.new" : "playlists.renameTitle")} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); if (trimmed && !pending) onSubmit(trimmed, collaborative); }}>
      <label htmlFor="playlist-name">{t("playlists.name")}</label>
      <input ref={field} id="playlist-name" type="text" value={name} maxLength={MAX_NAME} autoComplete="off"
        placeholder={t("playlists.namePlaceholder")} disabled={pending} onChange={(event) => setName(event.currentTarget.value)} />
      {creating && <label className="own-profile-toggle">
        <span><strong>{t("playlists.collaborative")}</strong><small>{t("playlists.collaborativeHint")}</small></span>
        <span className="switch"><input type="checkbox" checked={collaborative} disabled={pending}
          onChange={(event) => setCollaborative(event.currentTarget.checked)} /><span /></span>
      </label>}
      {failed && <small className="friends-inline-error" role="alert">{t("playlists.failed")}</small>}
      <div className="playlist-dialog-actions">
        <button type="button" className="secondary-button" disabled={pending} onClick={onClose}>{t("playlists.cancel")}</button>
        <button type="submit" className="primary-button" disabled={pending || !trimmed || (!creating && trimmed === initialName.trim())}>
          {t(creating ? "playlists.create" : "playlists.save")}
        </button>
      </div>
    </form>
  </PlaylistDialog>;
}
