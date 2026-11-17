import { ImagePlus, Music } from "lucide-react";
import { useRef, useState } from "react";
import { t } from "../../../i18n";
import { PROFILE_BANNERS, bannerLabel } from "../appearance";
import type { ProfileStyle } from "../friendsTypes";
import type { SharedTrack } from "../../listen-together/listenTogetherTypes";
import { MediaCropper, type Crop } from "../media/MediaCropper";
import { croppable, MEDIA_ACCEPT, SHAPES } from "../media/prepareMedia";
import { useMediaUpload } from "../media/useMediaUpload";
import { ProfileBanner } from "../ProfileBanner";
import { LookChoice, navigateChoices } from "./LookChoice";

/**
 * The backgrounds: standard, an own one (image, GIF or short video) and the
 * presets. The own one stays at hand while trying presets. A separate action
 * replaces the file, so selecting the tile never opens an unexpected dialog.
 */
export function BannerPicker({ style, own, onOwn, favorite, disabled, onBusy, onPick, onChooseSong }: {
  style: ProfileStyle;
  own: string | null;
  onOwn: (media: string) => void;
  favorite: SharedTrack | null;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onPick: (change: Partial<ProfileStyle>) => void;
  onChooseSong: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const media = useMediaUpload();
  const [cropping, setCropping] = useState<File>();
  const working = media.phase !== "idle";
  const ownSelected = Boolean(style.bannerMedia);
  const apply = async (file: File, crop?: Crop) => {
    setCropping(undefined);
    onBusy(true);
    try {
      const uploaded = await media.upload("banner", file, crop);
      if (uploaded) { onOwn(uploaded.id); onPick({ bannerMedia: uploaded.id }); }
    } finally { onBusy(false); }
  };

  return <fieldset>
    <legend>{t("appearance.banner")}</legend>
    <input ref={input} type="file" hidden accept={MEDIA_ACCEPT} disabled={disabled || working}
      onChange={async (event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        media.reset();
        if (await croppable(file)) setCropping(file);
        else void apply(file);
      }} />
    <div className="own-profile-banners" role="radiogroup" aria-label={t("appearance.banner")} onKeyDown={navigateChoices}>
      <LookChoice selected={!style.banner && !ownSelected} disabled={disabled || working} label={t("appearance.banner.default")} onPick={() => onPick({ banner: "", bannerMedia: null })}>
        <span className="own-profile-banner-swatch friend-profile-glow" />
      </LookChoice>
      <LookChoice selected={ownSelected} selectable={Boolean(own)} disabled={disabled || working || Boolean(cropping)} hint={t("profileLook.bannerChoose")}
        label={working ? t(media.phase === "preparing" ? "profileLook.preparing" : "profileLook.uploading") : t("profileLook.bannerOwn")}
        onPick={() => own ? onPick({ bannerMedia: own }) : input.current?.click()}>
        {own
          ? <ProfileBanner profile={{ style: { ...style, bannerMedia: own, effect: "" }, favorite }} className="own-profile-banner-swatch" effects={false} />
          : <span className="own-profile-banner-swatch" data-plain="true"><ImagePlus size={16} aria-hidden="true" /></span>}
      </LookChoice>
      {PROFILE_BANNERS.map((banner) => <LookChoice key={banner} selected={!ownSelected && style.banner === banner} label={t(bannerLabel(banner))}
        disabled={disabled || working || (banner === "cover" && !favorite?.coverUri)} hint={banner === "cover" && !favorite?.coverUri ? t("appearance.coverNeedsSong") : undefined}
        onPick={() => onPick({ banner, bannerMedia: null })}>
        {banner === "cover" && !favorite?.coverUri
          ? <span className="own-profile-banner-swatch" data-plain="true"><Music size={16} aria-hidden="true" /></span>
          : <ProfileBanner profile={{ style: { ...style, banner, bannerMedia: null, effect: "" }, favorite }} className="own-profile-banner-swatch" effects={false} />}
      </LookChoice>)}
    </div>
    {ownSelected && <button type="button" className="text-button" disabled={disabled || working || Boolean(cropping)} onClick={() => input.current?.click()}>
      <ImagePlus size={14} aria-hidden="true" />{t("profileLook.bannerChoose")}</button>}
    {!favorite?.coverUri && <button type="button" className="text-button" disabled={disabled || working} onClick={onChooseSong}>
      <Music size={14} aria-hidden="true" />{t("profileLook.chooseSongForCover")}</button>}
    {cropping && <MediaCropper key={`${cropping.name}-${cropping.lastModified}`} file={cropping} aspect={SHAPES.banner.width / SHAPES.banner.height}
      targetWidth={SHAPES.banner.width} onCancel={() => setCropping(undefined)} onConfirm={(crop) => void apply(cropping, crop)} />}
    {media.error ? <small className="friends-inline-error" role="alert">{media.error}</small> : !cropping && <small>{t("profileLook.bannerHint")}</small>}
  </fieldset>;
}
