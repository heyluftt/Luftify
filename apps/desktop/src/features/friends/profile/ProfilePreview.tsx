import { t } from "../../../i18n";
import { ActivityLine } from "../ActivityLine";
import { accentColor, nameAttrs, profileLook } from "../appearance";
import type { SocialProfile } from "../friendsTypes";
import { ProfileBanner } from "../ProfileBanner";
import { ProfileSong } from "../ProfileSong";
import { RoleAvatar, RoleBadges } from "../RoleBadge";
import { ProfileTrophies } from "./ProfileTrophies";

export type PreviewMode = "profile" | "card";

/** The draft exactly as friends will see it: their profile view or your card in their list. */
export function ProfilePreview({ profile, mode }: { profile: SocialProfile; mode: PreviewMode }) {
  const look = profileLook(profile);
  const name = <strong className="profile-name" {...nameAttrs(look)}>{profile.displayName}</strong>;
  const bio = profile.bio && <>{look.emoji && <span className="profile-emoji">{look.emoji}</span>}{profile.bio}</>;
  if (mode === "card") {
    return <div className="profile-preview-card friends-card" inert data-accent={look.accent} style={accentColor(look.color)}>
      <ProfileBanner profile={profile} className="friends-card-banner" effects={Boolean(look.bannerMedia)} />
      <div className="friends-card-main">
        <span className="friends-avatar-presence" data-activity="online">
          <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="lg" frame={look.frame} accent={look.accent} color={look.color} motion={look.avatarMedia} animate /><i />
        </span>
        {name}
        <RoleBadges roles={profile.roles} badges={profile.badges} quests={profile.achievements} shown={profile.style?.shownBadges} limit={3} />
        <ActivityLine activity="online" text={t("friends.online")} />
        {bio && <small className="friends-card-bio">{bio}</small>}
      </div>
    </div>;
  }
  return <div className="profile-preview-sheet" inert data-accent={look.accent} style={accentColor(look.color)} data-role={profile.roles?.[0]}>
    <div className="profile-preview-cover">
      {look.banner ? <ProfileBanner profile={profile} className="friend-profile-banner" /> : <div className="friend-profile-glow" />}
    </div>
    <div className="profile-preview-body">
      <span className="friends-avatar-presence" data-activity="online">
        <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="lg" frame={look.frame} accent={look.accent} color={look.color} motion={look.avatarMedia} animate /><i />
      </span>
      {name}
      <RoleBadges roles={profile.roles} badges={profile.badges} quests={profile.achievements} shown={profile.style?.shownBadges} />
      <ActivityLine activity="online" text={t("friends.online")} />
      {bio && <p>{bio}</p>}
      {profile.style?.showTrophies && <ProfileTrophies achievements={profile.achievements} />}
      {profile.favorite && <ProfileSong track={profile.favorite} accent={look.accent} color={look.color} />}
    </div>
  </div>;
}
