import { ListMusic, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { usePlaylistActions } from "../playlists/usePlaylistActions";
import type { FriendsControls, PlaylistShare, SocialSnapshot } from "./friendsTypes";

/** Playlists friends sent: joining puts one in the library and opens it. */
export function FriendsPlaylistShares({ snapshot, controls, disabled }: { snapshot: SocialSnapshot; controls: FriendsControls; disabled: boolean }) {
  const navigate = useNavigate();
  const { localReady } = usePlaybackEngine();
  const { followed } = usePlaylistActions();
  const shares = snapshot.playlistShares ?? [];
  if (!shares.length) return null;
  const busy = disabled || controls.pending || followed.isPending;
  const dismiss = (share: PlaylistShare) => controls.send({ type: "action", action: { type: "dismissPlaylistShare", shareId: share.id } });
  const join = async (share: PlaylistShare) => {
    // Without Librespot the page opens; following it is then up to Spotify.
    if (localReady) await followed.mutateAsync({ uri: share.playlist.uri, followed: true });
    dismiss(share);
    navigate(`/playlist/${encodeURIComponent(share.playlist.uri)}`, { state: { uri: share.playlist.uri, name: share.playlist.name, coverUri: share.playlist.coverUri ?? undefined } });
  };
  return <section id="playlist-shares" className="friends-panel friends-playlist-shares" aria-labelledby="friends-playlist-shares-title">
    <div className="friends-section-heading"><h2 id="friends-playlist-shares-title">{t("playlists.sharesTitle")}<span className="friends-count">{shares.length}</span></h2><ListMusic size={21} aria-hidden="true" /></div>
    <ul className="friends-people">{shares.map((share) => <li className="friends-person" key={share.id}>
      <span className="friends-share-art"><AlbumArt title={share.playlist.name} image={share.playlist.coverUri ?? undefined} size="small" /></span>
      <div className="friends-person-copy"><strong>{share.playlist.name}</strong>
        <small>{t("playlists.sharesFrom", { name: share.from.displayName })}</small></div>
      <div className="friends-row-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={() => void join(share).catch(() => undefined)}>{t("playlists.join")}</button>
        <button type="button" className="friends-icon-button" disabled={busy} title={t("playlists.decline")}
          aria-label={t("playlists.declineFrom", { name: share.from.displayName })} onClick={() => dismiss(share)}><X size={18} aria-hidden="true" /></button>
      </div>
    </li>)}</ul>
    {followed.isError && <small className="friends-inline-error" role="alert">{t("playlists.failed")}</small>}
  </section>;
}
