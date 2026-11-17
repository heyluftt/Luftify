import { AlbumArt } from "../../components/AlbumArt";
import type { SocialProfile } from "./friendsTypes";
import { accentColor, profileLook } from "./appearance";
import { BannerEffect } from "./effects/BannerEffect";
import { MotionMedia } from "./media/MotionMedia";
import { BannerArtwork } from "./profile/BannerArtwork";

/** The profile's chosen background; nothing for profiles without a style. */
export function ProfileBanner({ profile, className, effects = true }: {
  profile: Pick<SocialProfile, "style" | "favorite">;
  className?: string;
  /** Small banners (cards, swatches) stay still. */
  effects?: boolean;
}) {
  const look = profileLook(profile);
  if (!look.banner) return null;
  return <div className={className ? `profile-banner ${className}` : "profile-banner"} data-banner={look.banner} data-accent={look.accent} data-still={effects ? undefined : ""}
    style={accentColor(look.color)} aria-hidden="true">
    {look.cover && <AlbumArt title="" image={look.cover} size="small" />}
    {look.bannerMedia && <MotionMedia id={look.bannerMedia} playing={effects} className="profile-banner-media" />}
    <BannerArtwork banner={look.banner} />
    {effects && look.effect && <BannerEffect effect={look.effect} />}
  </div>;
}
