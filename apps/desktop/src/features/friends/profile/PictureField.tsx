import { Camera, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { t } from "../../../i18n";
import { profileImage } from "../../settings/profileImage";
import { MediaCropper, type Crop } from "../media/MediaCropper";
import { croppable, isStillImage, MEDIA_ACCEPT, SHAPES } from "../media/prepareMedia";
import { useMediaUpload } from "../media/useMediaUpload";
import { RoleAvatar } from "../RoleBadge";

export interface Picture {
  /** The still picture, inline. */
  avatar: string | null;
  /** The moving one, a media id; its first frame is `avatar`. */
  motion: string | null;
}

/**
 * Profile picture: a still image stays inline as before; a GIF, animated
 * WebP or short video is uploaded, with its first frame as the still one.
 */
export function PictureField({ name, picture, roles, frame, accent, color, disabled, onBusy, onChange }: {
  name: string;
  picture: Picture;
  roles: readonly string[] | undefined;
  frame: string | undefined;
  accent: string | undefined;
  color: string | undefined;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onChange: (picture: Picture) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const media = useMediaUpload();
  // A picked file waits here while its part is chosen.
  const [cropping, setCropping] = useState<File>();
  const working = media.phase !== "idle";

  const apply = async (file: File, crop?: Crop) => {
    setCropping(undefined);
    onBusy(true);
    try {
      if (await isStillImage(file)) {
        media.reset();
        try {
          onChange({ avatar: await profileImage(file, crop), motion: null });
        } catch {
          media.fail(t("listen.profileImageError"));
        }
        return;
      }
      const uploaded = await media.upload("avatar", file, crop);
      if (uploaded) onChange({ avatar: uploaded.poster ?? picture.avatar, motion: uploaded.id });
    } finally {
      onBusy(false);
    }
  };
  const pick = async (file: File) => {
    media.reset();
    if (await croppable(file)) setCropping(file);
    else void apply(file);
  };

  return <fieldset>
    <legend>{t("appearance.picture")}</legend>
    <div className="own-profile-avatar">
      <RoleAvatar name={name} uri={picture.avatar} roles={roles} size="md" frame={frame} accent={accent} color={color}
        motion={picture.motion ?? undefined} animate />
      <input ref={input} type="file" hidden accept={MEDIA_ACCEPT} disabled={disabled || working}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void pick(file);
        }} />
      <button type="button" className="secondary-button" disabled={disabled || working || Boolean(cropping)} onClick={() => input.current?.click()}>
        <Camera size={15} aria-hidden="true" />
        {t(media.phase === "preparing" ? "profileLook.preparing" : media.phase === "uploading" ? "profileLook.uploading" : "listen.profileChoose")}
      </button>
      {picture.avatar && <button type="button" className="friends-icon-button" disabled={disabled || working}
        onClick={() => { media.reset(); onChange({ avatar: null, motion: null }); }}
        title={t("listen.profileRemove")} aria-label={t("listen.profileRemove")}><Trash2 size={16} aria-hidden="true" /></button>}
    </div>
    {cropping && <MediaCropper key={`${cropping.name}-${cropping.lastModified}`} file={cropping} aspect={1} round targetWidth={SHAPES.avatar.width}
      onCancel={() => setCropping(undefined)} onConfirm={(crop) => void apply(cropping, crop)} />}
    {media.error ? <small className="friends-inline-error" role="alert">{media.error}</small> : !cropping && <small>{t("profileLook.pictureHint")}</small>}
  </fieldset>;
}
