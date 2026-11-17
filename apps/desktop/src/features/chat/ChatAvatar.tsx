import type { SocialProfile } from "../friends/friendsTypes";
import { RoleAvatar } from "../friends/RoleBadge";
import { profileLook } from "../friends/appearance";

export function ChatAvatar({ profile, size = "sm" }: { profile: SocialProfile; size?: "sm" | "md" }) {
  const look = profileLook(profile);
  return <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size={size}
    frame={look.frame} accent={look.accent} color={look.color} />;
}
