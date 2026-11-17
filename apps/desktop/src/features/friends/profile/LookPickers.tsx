import { t } from "../../../i18n";
import { PROFILE_EFFECTS, PROFILE_FRAMES, accentColor, effectLabel, frameLabel } from "../appearance";
import { REWARD_FRAME } from "../achievements/achievements";
import type { ProfileStyle, SocialProfile } from "../friendsTypes";
import { ProfileBanner } from "../ProfileBanner";
import { RoleAvatar } from "../RoleBadge";
import { LookChoice, navigateChoices } from "./LookChoice";

interface PickerProps {
  profile: SocialProfile;
  /** The look being edited, so every tile shows the user's own colours. */
  style: ProfileStyle;
  disabled: boolean;
  onPick: (value: string) => void;
}

/** Each effect running live on a small copy of the chosen background. */
export function EffectPicker({ profile, style, disabled, onPick }: PickerProps) {
  return <div className="look-tiles" role="radiogroup" aria-label={t("appearance.effect")} onKeyDown={navigateChoices}>
    {PROFILE_EFFECTS.map((effect) => <LookChoice key={effect || "none"} disabled={disabled}
      selected={(style.effect ?? "") === effect} label={t(effectLabel(effect))} onPick={() => onPick(effect)}>
      <span className="look-tile-stage" data-accent={style.accent} style={accentColor(style.color)}>
        <ProfileBanner profile={{ style: { ...style, banner: style.banner || "mono", bannerMedia: null, effect }, favorite: profile.favorite ?? null }} className="look-tile-banner" />
      </span>
    </LookChoice>)}
  </div>;
}

/** Each frame around the user's own picture; the reward frame stays locked until earned. */
export function FramePicker({ profile, style, disabled, onPick }: PickerProps) {
  const earned = Boolean(profile.achievements?.includes("collector"));
  return <div className="look-tiles" data-kind="frame" role="radiogroup" aria-label={t("appearance.frame")} onKeyDown={navigateChoices}>
    {PROFILE_FRAMES.map((frame) => {
      const locked = frame === REWARD_FRAME && !earned && style.frame !== frame;
      return <LookChoice key={frame || "role"} disabled={disabled} locked={locked}
        selected={(style.frame ?? "") === frame} label={t(frameLabel(frame))} onPick={() => onPick(frame)} hint={locked ? t("achievements.lockedFrame") : undefined}>
        <span className="look-tile-stage" data-accent={style.accent} style={accentColor(style.color)}>
          <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="md" frame={frame || undefined} accent={style.accent} color={style.color ?? undefined} />
        </span>
      </LookChoice>;
    })}
  </div>;
}
