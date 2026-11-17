import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlbumArt } from "../../../components/AlbumArt";
import { t } from "../../../i18n";
import { accentColor, nameAttrs, profileLook } from "../appearance";
import type { Activity, SocialProfile } from "../friendsTypes";
import { ProfileBanner } from "../ProfileBanner";
import { ProfileSong } from "../ProfileSong";
import { RoleAvatar, RoleBadges } from "../RoleBadge";
import { mainRole } from "../roles";
import { ProfileTrophies } from "./ProfileTrophies";
import { useModalDialog } from "./useModalDialog";

/**
 * The profile as a dialog: a banner across the top, the picture overlapping
 * it, the name with badges and status on one line, the bio, then the
 * person's buttons and one column of music (profile song, now, recent).
 */
export function ProfileSheet({ profile, activity, status, glow, hero, wide = false, actions, footer, onClose, children }: {
  profile: SocialProfile;
  activity: Activity;
  /** Under the badges, e.g. the activity line. */
  status: ReactNode;
  /** A cover for profiles without a chosen background. */
  glow: string | undefined;
  /** Replaces the profile view, e.g. while editing. */
  hero?: ReactNode;
  /** Room for the editor with its live preview. */
  wide?: boolean;
  /** Right under the identity, before the music (message, listen along …). */
  actions?: ReactNode;
  /** Quiet facts at the very end, e.g. friends since. */
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  useModalDialog(dialog, onClose);
  const look = profileLook(profile);
  return createPortal(<div className="friend-profile-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="friend-profile" role="dialog" aria-modal="true" aria-labelledby="friend-profile-name"
      tabIndex={-1} data-role={mainRole(profile.roles)} data-accent={look.accent} style={accentColor(look.color)} data-wide={wide || undefined} data-editing={hero ? true : undefined}>
      <button type="button" className="friends-icon-button friend-profile-close" onClick={onClose} aria-label={t("friendProfile.close")} title={t("friendProfile.close")}>
        <X size={18} aria-hidden="true" />
      </button>
      {hero ?? <div className="friend-profile-scroll">
        <div className="friend-profile-cover" aria-hidden="true">
          {look.banner
            ? <ProfileBanner profile={profile} className="friend-profile-banner" />
            : <div className="friend-profile-glow">{glow && <AlbumArt title="" image={glow} size="small" />}</div>}
        </div>
        <header className="friend-profile-hero">
          <span className="friends-avatar-presence" data-activity={activity}>
            <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="xl" frame={look.frame} accent={look.accent} color={look.color} motion={look.avatarMedia} animate /><i />
          </span>
          <h2 id="friend-profile-name" className="profile-name" {...nameAttrs(look)}>{profile.displayName}</h2>
          <div className="friend-profile-meta">
            <RoleBadges roles={profile.roles} badges={profile.badges} quests={profile.achievements} shown={profile.style?.shownBadges} size="md" />
            {status && <div className="friend-profile-status">{status}</div>}
          </div>
          {profile.bio && <p className="friend-profile-bio">{look.emoji && <span className="profile-emoji">{look.emoji}</span>}{profile.bio}</p>}
          {profile.style?.showTrophies && <ProfileTrophies achievements={profile.achievements} />}
        </header>
        {actions}
        <div className="friend-profile-sections">
          {profile.favorite && <ProfileSong track={profile.favorite} accent={look.accent} color={look.color} />}
          {children}
        </div>
        {footer && <footer className="friend-profile-footer">{footer}</footer>}
      </div>}
      {hero && children}
    </section>
  </div>, document.body);
}
