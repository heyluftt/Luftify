import { Image, Palette, Sparkles, Type, Circle } from "lucide-react";
import { useState } from "react";
import { t } from "../../../i18n";
import { ACCENT_HEX } from "../color/color";
import { accentColor, accentLabel, bannerLabel, effectLabel, frameLabel, nameAttrs, profileLook } from "../appearance";
import type { ProfileStyle, SocialProfile } from "../friendsTypes";
import { ProfileBanner } from "../ProfileBanner";
import { RoleAvatar } from "../RoleBadge";
import { BannerPicker } from "./BannerPicker";
import { ProfileColorField } from "./ColorFields";
import { LookSection } from "./LookSection";
import { EffectPicker, FramePicker } from "./LookPickers";
import { NameGradientField } from "./NameGradientField";

type Part = "color" | "name" | "banner" | "effect" | "frame";

/** Only one palette is open; the draft and its live preview stay in the parent. */
export function ProfileLookEditor({ profile, style, disabled, uploadingDisabled, ownBanner, onOwnBanner, onBusy, onPick, onChooseSong }: {
  profile: SocialProfile;
  style: ProfileStyle;
  disabled: boolean;
  uploadingDisabled: boolean;
  ownBanner: string | null;
  onOwnBanner: (media: string) => void;
  onBusy: (busy: boolean) => void;
  onPick: (change: Partial<ProfileStyle>) => void;
  onChooseSong: () => void;
}) {
  const [part, setPart] = useState<Part | null>("color");
  const toggle = (key: Part) => () => setPart(part === key ? null : key);
  const scene = { ...profile, style: { ...style, banner: style.banner || "mono" } };
  return <div className="look-sections" data-accent={style.accent} style={accentColor(style.color)}>
    <LookSection id="color" icon={<Palette size={18} />} title={t("profileLook.color")} open={part === "color"} onToggle={toggle("color")}
      value={style.color ?? t(accentLabel(style.accent))} preview={<i className="look-section-swatch" />}>
      <ProfileColorField accent={style.accent} color={style.color ?? null} disabled={disabled} onChange={onPick} />
      <small className="look-hint">{t("profileLook.colorHint")}</small>
    </LookSection>
    <LookSection id="frame" icon={<Circle size={18} />} title={t("appearance.frame")} open={part === "frame"} onToggle={toggle("frame")}
      value={t(frameLabel(style.frame ?? ""))}
      preview={<RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="sm" frame={style.frame || undefined} accent={style.accent} color={style.color ?? undefined} />}>
      <FramePicker profile={profile} style={style} disabled={disabled} onPick={(frame) => onPick({ frame })} />
    </LookSection>
    <LookSection id="name" icon={<Type size={18} />} title={t("profileLook.name")} open={part === "name"} onToggle={toggle("name")}
      value={t(style.nameGradient ? "profileLook.nameGradientOn" : "profileLook.nameGradientOff")}
      preview={<span className="look-section-name"><strong className="profile-name" {...nameAttrs(profileLook(profile))}>{profile.displayName}</strong></span>}>
      <NameGradientField on={Boolean(style.nameGradient)} from={style.nameFrom ?? null} to={style.nameColor ?? null}
        base={style.color ?? ACCENT_HEX[style.accent] ?? ACCENT_HEX.sky!} disabled={disabled} onChange={onPick} />
    </LookSection>
    <LookSection id="banner" icon={<Image size={18} />} title={t("appearance.banner")} open={part === "banner"} onToggle={toggle("banner")}
      value={style.bannerMedia ? t("profileLook.bannerOwn") : style.banner ? t(bannerLabel(style.banner)) : t("appearance.banner.default")}
      preview={<span className="look-section-scene"><ProfileBanner profile={scene} className="look-tile-banner" effects={false} /></span>}>
      <BannerPicker style={style} own={ownBanner} onOwn={onOwnBanner} favorite={profile.favorite ?? null} disabled={uploadingDisabled} onBusy={onBusy} onPick={onPick} onChooseSong={onChooseSong} />
    </LookSection>
    <LookSection id="effect" icon={<Sparkles size={18} />} title={t("appearance.effect")} open={part === "effect"} onToggle={toggle("effect")}
      value={t(effectLabel(style.effect ?? ""))}
      preview={<span className="look-section-scene"><ProfileBanner profile={scene} className="look-tile-banner" /></span>}>
      <EffectPicker profile={profile} style={style} disabled={disabled} onPick={(effect) => onPick({ effect })} />
    </LookSection>
  </div>;
}
