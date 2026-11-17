import { t } from "../../i18n";
import { ProfileAvatar } from "../listen-together/ProfileAvatar";
import { accentColor } from "./appearance";
import { MotionMedia } from "./media/MotionMedia";
import { AvatarFrameArt, MATERIAL_FRAMES } from "./profile/AvatarFrameArt";
import { Star } from "lucide-react";
import { badgeIcon, useBadgeCatalog } from "./customBadges";
import type { BadgeDefinition, SocialRole } from "./friendsTypes";
import { ACHIEVEMENT_INFO, achievementName, type AchievementId } from "./achievements/achievements";
import { ownedBadges, shownBadges, type OwnedBadge } from "./badgeInventory";
import { ROLES, mainRole } from "./roles";

type BadgeSize = "sm" | "md" | "lg";

export function RoleBadge({ role, size = "sm", iconOnly = false }: { role: SocialRole; size?: BadgeSize; iconOnly?: boolean }) {
  const { icon: Icon, label, hint } = ROLES[role];
  return <span className="role-badge" data-role={role} data-size={size} data-icon-only={iconOnly || undefined}
    title={`${t(label)} · ${t(hint)}`} aria-label={iconOnly ? t(label) : undefined}>
    <Icon aria-hidden="true" strokeWidth={2.2} />
    {!iconOnly && <span>{t(label)}</span>}
  </span>;
}

/** A badge Luft made. Colours come from roles.css. */
export function CustomBadge({ badge, size = "sm" }: { badge: BadgeDefinition; size?: BadgeSize }) {
  const Icon = badgeIcon(badge.icon) ?? Star;
  return <span className="role-badge" data-badge-color={badge.color} data-size={size} title={badge.label}>
    <Icon aria-hidden="true" strokeWidth={2.2} /><span>{badge.label}</span>
  </span>;
}

/** A badge for a reached achievement. */
export function QuestBadge({ quest, size = "sm" }: { quest: AchievementId; size?: BadgeSize }) {
  const { icon: Icon, color } = ACHIEVEMENT_INFO[quest];
  return <span className="role-badge" data-badge-color={color} data-quest={quest} data-size={size} title={t(achievementName(quest))}>
    <Icon aria-hidden="true" strokeWidth={2.2} /><span>{t(achievementName(quest))}</span>
  </span>;
}

/** Name and look of any owned badge, for lists like the inventory. */
export function ownedLabel(owned: OwnedBadge): string {
  return owned.kind === "role" ? t(ROLES[owned.role].label) : owned.kind === "badge" ? owned.badge.label : t(achievementName(owned.quest));
}
export function OwnedBadgeView({ owned, size = "sm" }: { owned: OwnedBadge; size?: BadgeSize }) {
  if (owned.kind === "role") return <RoleBadge role={owned.role} size={size} />;
  if (owned.kind === "badge") return <CustomBadge badge={owned.badge} size={size} />;
  return <QuestBadge quest={owned.quest} size={size} />;
}

/**
 * Roles first, then Luft's own badges and achievements, or the profile's own
 * choice in its order (`shown`). `limit` folds the rest into a "+n" whose
 * tooltip names them.
 */
export function RoleBadges({ roles, badges, quests, shown: chosen, size = "sm", limit }: {
  roles: readonly string[] | undefined;
  badges?: readonly string[] | undefined;
  /** Reached achievements; they only show when chosen. */
  quests?: readonly string[] | undefined;
  /** The look's `shownBadges`; without it everything owned shows. */
  shown?: readonly string[] | null | undefined;
  size?: BadgeSize;
  limit?: number;
}) {
  const catalog = useBadgeCatalog();
  // Without a choice, achievements stay in the inventory: everything else shows as before.
  const owned = ownedBadges({ roles, badges, achievements: chosen ? quests : undefined }, catalog);
  const items = shownBadges(owned, chosen)
    .map((badge) => ({ key: badge.key, label: ownedLabel(badge), node: <OwnedBadgeView key={badge.key} owned={badge} size={size} /> }));
  if (!items.length) return null;
  const shown = limit ? items.slice(0, limit) : items;
  return <span className="role-badges" data-size={size}>
    {shown.map((item) => item.node)}
    {shown.length < items.length && <span className="role-badge-more" title={items.slice(shown.length).map((item) => item.label).join(", ")}>+{items.length - shown.length}</span>}
  </span>;
}

/** Material frames and role rings with a separate light halo. */
const ROLES_WITH_LAYER = new Set(["luft", "crew"]);

/** The avatar with a ring in the colours of the main role. */
export function RoleAvatar({ name, uri, roles, size = "md", frame, accent, color, motion, animate = false }: {
  name: string;
  uri?: string | null | undefined;
  roles?: readonly string[] | undefined;
  size?: "sm" | "md" | "lg" | "xl";
  /** The profile's chosen material frame; otherwise the role's ring. */
  frame?: string | undefined;
  accent?: string | undefined;
  /** Own profile colour for the frame. */
  color?: string | undefined;
  /** The moving picture, played while `animate` (lists show the still one). */
  motion?: string | undefined;
  animate?: boolean;
}) {
  const role = frame ? undefined : mainRole(roles);
  const layer = frame ? MATERIAL_FRAMES.has(frame) : Boolean(role && ROLES_WITH_LAYER.has(role));
  return <span className="role-avatar" data-role={role} data-size={size} data-frame={frame} data-accent={frame ? accent : undefined}
    style={frame ? accentColor(color) : undefined}>
    <ProfileAvatar name={name} uri={uri}>{motion && animate && <MotionMedia id={motion} className="listen-avatar-motion" />}</ProfileAvatar>
    {layer && <i className="avatar-frame-fx" aria-hidden="true" />}
    {frame && <AvatarFrameArt frame={frame} />}
  </span>;
}
