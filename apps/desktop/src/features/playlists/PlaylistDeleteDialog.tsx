import { t } from "../../i18n";
import { PlaylistDialog } from "./PlaylistDialog";

export function PlaylistDeleteDialog({ name, pending, failed, onConfirm, onClose }: {
  name: string;
  pending: boolean;
  failed: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return <PlaylistDialog id="playlist-delete-title" title={t("playlists.deleteTitle", { name })} onClose={onClose}>
    <p>{t("playlists.deleteText")}</p>
    {failed && <small className="friends-inline-error" role="alert">{t("playlists.failed")}</small>}
    <div className="playlist-dialog-actions">
      <button type="button" className="secondary-button" disabled={pending} onClick={onClose}>{t("playlists.cancel")}</button>
      <button type="button" className="primary-button" data-danger disabled={pending} onClick={onConfirm}>{t("playlists.delete")}</button>
    </div>
  </PlaylistDialog>;
}
