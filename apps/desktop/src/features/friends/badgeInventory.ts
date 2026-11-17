import { ACHIEVEMENTS, type AchievementId } from "./achievements/achievements";
import type { BadgeDefinition } from "./friendsTypes";
import { knownRoles } from "./roles";

/** Mirrors MAX_SHOWN_BADGES in luft-listen-together. */
export const MAX_SHOWN_BADGES = 6;

export type OwnedBadge =
  | { key: string; kind: "role"; role: ReturnType<typeof knownRoles>[number] }
  | { key: string; kind: "badge"; badge: BadgeDefinition }
  | { key: string; kind: "quest"; quest: AchievementId };

/** Everything a profile owns: its roles in rank order, Luft's badges, then reached achievements. */
export function ownedBadges(profile: {
  roles?: readonly string[] | undefined;
  badges?: readonly string[] | undefined;
  achievements?: readonly string[] | undefined;
}, catalog: readonly BadgeDefinition[]): OwnedBadge[] {
  return [
    ...knownRoles(profile.roles).map((role) => ({ key: `role:${role}`, kind: "role" as const, role })),
    ...(profile.badges ?? []).flatMap((id) => {
      const badge = catalog.find((entry) => entry.id === id);
      return badge ? [{ key: `badge:${id}`, kind: "badge" as const, badge }] : [];
    }),
    ...ACHIEVEMENTS.filter((id) => profile.achievements?.includes(id)).map((quest) => ({ key: `quest:${quest}`, kind: "quest" as const, quest })),
  ];
}

/** What is shown, in order: the chosen ones still owned, or all without a choice. */
export function shownBadges(owned: OwnedBadge[], shown: readonly string[] | null | undefined): OwnedBadge[] {
  if (!shown) return owned;
  return shown.flatMap((key) => owned.filter((badge) => badge.key === key));
}
