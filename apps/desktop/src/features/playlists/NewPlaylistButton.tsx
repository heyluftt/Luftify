import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../i18n";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { PlaylistNameDialog } from "./PlaylistNameDialog";
import { usePlaylistActions } from "./usePlaylistActions";

/** In the library: a new playlist, opened right after it exists. */
export function NewPlaylistButton() {
  const navigate = useNavigate();
  const { localReady } = usePlaybackEngine();
  const { create } = usePlaylistActions();
  const [open, setOpen] = useState(false);
  if (!localReady) return null;
  const close = () => {
    setOpen(false);
    create.reset();
  };
  return <>
    <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
      <Plus size={16} aria-hidden="true" />{t("playlists.new")}
    </button>
    {open && <PlaylistNameDialog creating pending={create.isPending} failed={create.isError} onClose={close}
      onSubmit={(name, collaborative) => create.mutate({ name, collaborative }, {
        onSuccess: (uri) => {
          close();
          navigate(`/playlist/${encodeURIComponent(uri)}`, { state: { uri, name } });
        },
      })} />}
  </>;
}
