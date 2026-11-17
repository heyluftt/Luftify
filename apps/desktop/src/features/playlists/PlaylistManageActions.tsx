import { ImagePlus, Pencil, Plus, Trash2, UserMinus, Users, UsersRound } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../i18n";
import { ProfileMenu, type ProfileMenuItem } from "../friends/profile/ProfileMenu";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { PlaylistDeleteDialog } from "./PlaylistDeleteDialog";
import { PlaylistNameDialog } from "./PlaylistNameDialog";
import { PlaylistShareDialog } from "./PlaylistShareDialog";
import { usePlaylistActions, usePlaylistStanding } from "./usePlaylistActions";

type Open = "rename" | "delete" | "share" | null;

/** On a playlist page: share with friends; own ones can be renamed, made collaborative and deleted. */
export function PlaylistManageActions({ uri, name, coverUri, onEditCover }: { uri: string; name: string; coverUri?: string | undefined; onEditCover?: (() => void) | undefined }) {
  const navigate = useNavigate();
  const { localReady } = usePlaybackEngine();
  const standing = usePlaylistStanding(uri);
  const actions = usePlaylistActions();
  const [open, setOpen] = useState<Open>(null);
  const close = () => {
    setOpen(null);
    actions.rename.reset();
    actions.followed.reset();
  };

  const items: ProfileMenuItem[] = !localReady ? [] : standing.own ? [
    { icon: Pencil, label: t("playlists.rename"), onSelect: () => setOpen("rename") },
    standing.collaborative
      ? { icon: UsersRound, label: t("playlists.endCollaborative"), onSelect: () => actions.collaborative.mutate({ uri, collaborative: false }) }
      : { icon: UsersRound, label: t("playlists.makeCollaborative"), onSelect: () => actions.collaborative.mutate({ uri, collaborative: true }) },
    { icon: Trash2, label: t("playlists.delete"), danger: true, onSelect: () => setOpen("delete") },
  ] : standing.inLibrary ? [
    { icon: UserMinus, label: t("playlists.unfollow"), onSelect: () => actions.followed.mutate({ uri, followed: false }) },
  ] : [];
  if (localReady && onEditCover) items.unshift({ icon: ImagePlus, label: t("playlists.coverTitle"), onSelect: onEditCover });

  return <>
    {localReady && !standing.inLibrary && (
      <button type="button" className="secondary-button" disabled={actions.followed.isPending}
        onClick={() => actions.followed.mutate({ uri, followed: true })}>
        <Plus size={16} aria-hidden="true" />{t("playlists.follow")}
      </button>
    )}
    <button type="button" className="secondary-button" onClick={() => setOpen("share")}>
      <Users size={16} aria-hidden="true" />{t("playlists.share")}
    </button>
    {items.length > 0 && <ProfileMenu items={items} />}
    {(actions.collaborative.isError || (actions.followed.isError && open === null)) && (
      <span className="playlist-manage-status" role="alert">{t("playlists.failed")}</span>
    )}

    {open === "share" && <PlaylistShareDialog playlist={{ uri, name, ...(coverUri ? { coverUri } : {}) }}
      own={standing.own && localReady} collaborative={standing.collaborative} onClose={close} />}
    {open === "rename" && <PlaylistNameDialog initialName={name} creating={false}
      pending={actions.rename.isPending} failed={actions.rename.isError}
      onSubmit={(next) => actions.rename.mutate({ uri, name: next }, { onSuccess: close })} onClose={close} />}
    {open === "delete" && <PlaylistDeleteDialog name={name}
      pending={actions.followed.isPending} failed={actions.followed.isError}
      onConfirm={() => actions.followed.mutate({ uri, followed: false }, { onSuccess: () => { close(); navigate("/library"); } })}
      onClose={close} />}
  </>;
}
