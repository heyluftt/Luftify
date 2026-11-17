import { Check, ImagePlus, LoaderCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { MediaCropper, type Crop } from "../friends/media/MediaCropper";
import { PlaylistDialog } from "./PlaylistDialog";
import { PLAYLIST_COVER_ACCEPT, preparePlaylistCover } from "./preparePlaylistCover";
import { refreshPlaylists } from "./usePlaylistActions";

export function PlaylistCoverDialog({ uri, image, onSaved, onClose }: {
  uri: string; image?: string | undefined; onSaved: (preview: string) => void; onClose: () => void;
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const task = useRef(0);
  const save = useMutation({
    mutationFn: (data: string) => desktopApi.setPlaylistCover(uri, data.slice(data.indexOf(",") + 1)),
    onSuccess: (_result, data) => {
      onSaved(data);
      void refreshPlaylists(client, uri);
      onClose();
    },
  });
  const busy = preparing || save.isPending;
  const close = () => { if (!save.isPending) { task.current++; onClose(); } };
  const apply = async (crop: Crop) => {
    if (!file) return;
    const current = ++task.current;
    setPreparing(true); setInvalid(false);
    try {
      const data = await preparePlaylistCover(file, crop);
      if (current === task.current) { setPreview(data); setFile(undefined); }
    } catch { if (current === task.current) setInvalid(true); }
    finally { if (current === task.current) setPreparing(false); }
  };
  const permission = (save.error as { message?: string } | null)?.message === "playlistCoverPermission";
  return <PlaylistDialog id="playlist-cover-title" title={t("playlists.coverTitle")} onClose={close}>
    {file && !preparing ? <MediaCropper key={`${file.name}-${file.lastModified}`} file={file} aspect={1} targetWidth={640}
      onError={() => { setInvalid(true); setFile(undefined); }}
      onCancel={() => { task.current++; setFile(undefined); setInvalid(false); }} onConfirm={(crop) => void apply(crop)} /> : <>
      <div className="playlist-cover-preview">
        {(preview ?? image) ? <img src={preview ?? image} alt={t("playlists.coverPreview")} /> : <ImagePlus size={40} aria-hidden="true" />}
        {preparing && <LoaderCircle className="playlist-preparation-spinner" size={28} aria-label={t("playlists.coverPreparing")} />}
      </div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => input.current?.click()}>
        <ImagePlus size={16} aria-hidden="true" />{t("playlists.coverChoose")}
      </button>
      <p>{t("playlists.coverHint")}</p>
      <div className="playlist-dialog-actions">
        <button type="button" className="secondary-button" disabled={save.isPending} onClick={close}>{t("playlists.cancel")}</button>
        <button type="button" className="primary-button" disabled={!preview || busy} aria-busy={save.isPending}
          onClick={() => preview && save.mutate(preview)}>
          {save.isPending ? <LoaderCircle className="playlist-preparation-spinner" size={16} /> : <Check size={16} />}{t("playlists.save")}
        </button>
      </div>
    </>}
    <input ref={input} type="file" accept={PLAYLIST_COVER_ACCEPT} hidden onChange={(event) => {
      const chosen = event.currentTarget.files?.[0]; event.currentTarget.value = "";
      if (!chosen) return;
      save.reset(); setInvalid(false);
      if (!PLAYLIST_COVER_ACCEPT.split(",").includes(chosen.type) || chosen.size > 20 * 1024 * 1024) { setInvalid(true); return; }
      setFile(chosen);
    }} />
    {(invalid || save.isError) && <p className="playlist-manage-status" role="alert">{t(invalid ? "playlists.coverInvalid" : permission ? "playlists.coverPermission" : "playlists.coverFailed")}</p>}
  </PlaylistDialog>;
}
