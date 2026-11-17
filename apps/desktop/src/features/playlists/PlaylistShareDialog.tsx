import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { friendsApi } from "../friends/friendsApi";
import type { FriendsStatus, SharedPlaylist } from "../friends/friendsTypes";
import { RoleAvatar } from "../friends/RoleBadge";
import { FRIENDS_QUERY_KEY, friendsErrorText, useFriends } from "../friends/useFriends";
import { PlaylistDialog } from "./PlaylistDialog";

/**
 * Send a playlist to friends; they find it under "Friends" and join with one
 * click. Making it collaborative on the way lets them add songs.
 */
export function PlaylistShareDialog({ playlist, own, collaborative, onClose }: {
  playlist: SharedPlaylist;
  own: boolean;
  collaborative: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const friends = useFriends();
  const snapshot = friends.data?.snapshot;
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [makeCollaborative, setMakeCollaborative] = useState(own && !collaborative);
  const send = useMutation({
    mutationFn: async () => {
      if (makeCollaborative) await desktopApi.setPlaylistCollaborative(playlist.uri, true);
      let status: FriendsStatus | undefined;
      for (const profileId of chosen) {
        status = await friendsApi.run({ type: "action", action: { type: "sharePlaylist", profileId, playlist } });
      }
      return status;
    },
    onSuccess: (status) => {
      if (status) client.setQueryData(FRIENDS_QUERY_KEY, status);
      if (makeCollaborative) void client.invalidateQueries({ queryKey: ["library", "playlists"] });
    },
  });
  const toggle = (id: string) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const people = snapshot?.friends ?? [];
  const sentTo = people.find((friend) => chosen.has(friend.profile.id))?.profile.displayName ?? "";

  return <PlaylistDialog id="playlist-share-title" title={t("playlists.shareTitle", { name: playlist.name })} onClose={onClose}>
    {send.isSuccess
      ? <div className="playlist-dialog-done" role="status">
        <span aria-hidden="true"><Check size={22} /></span>
        <strong>{chosen.size === 1 ? t("playlists.shareSentOne", { name: sentTo }) : t("playlists.shareSent", { n: chosen.size })}</strong>
        <button type="button" className="secondary-button" onClick={onClose}>{t("playlists.close")}</button>
      </div>
      : <>
        {!snapshot ? <p>{t("playlists.friendsOff")}</p>
          : people.length === 0 ? <p>{t("playlists.noFriends")}</p>
          : <ul className="playlist-share-friends">{people.map(({ profile }) => <li key={profile.id}>
            <label>
              <input type="checkbox" checked={chosen.has(profile.id)} disabled={send.isPending} onChange={() => toggle(profile.id)} />
              <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="sm" />
              <span>{profile.displayName}</span>
            </label>
          </li>)}</ul>}
        {own && !collaborative && <label className="own-profile-toggle">
          <span><strong>{t("playlists.collaborative")}</strong><small>{t("playlists.collaborativeHint")}</small></span>
          <span className="switch"><input type="checkbox" checked={makeCollaborative} disabled={send.isPending}
            onChange={(event) => setMakeCollaborative(event.currentTarget.checked)} /><span /></span>
        </label>}
        {send.isError && <small className="friends-inline-error" role="alert">{friendsErrorText(send.error) ?? t("playlists.failed")}</small>}
        <div className="playlist-dialog-actions">
          <button type="button" className="secondary-button" disabled={send.isPending} onClick={onClose}>{t("playlists.cancel")}</button>
          <button type="button" className="primary-button" disabled={send.isPending || chosen.size === 0} onClick={() => send.mutate()}>
            {t("playlists.shareSend")}
          </button>
        </div>
      </>}
  </PlaylistDialog>;
}
