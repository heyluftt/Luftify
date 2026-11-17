import type { BadgeDefinition, FriendsControls, SocialProfile, SocialRole } from "../friendsTypes";
import { CustomBadge, RoleBadge } from "../RoleBadge";
import { GRANTABLE_ROLES } from "../roles";

/**
 * Luft gives and takes roles and badges for one person. Giving needs a
 * friendship (the server checks); people who are no longer friends can only
 * lose them. Luft itself cannot be given.
 */
export function BadgeChips({ person, canGive, catalog, controls, disabled }: {
  person: SocialProfile;
  canGive: boolean;
  catalog: BadgeDefinition[];
  controls: FriendsControls;
  disabled: boolean;
}) {
  const busy = disabled || controls.pending;
  const toggleRole = (role: SocialRole, held: boolean) =>
    controls.send({ type: "action", action: { type: "setRole", profileId: person.id, role, enabled: !held } });
  const toggleBadge = (badge: BadgeDefinition, held: boolean) =>
    controls.send({ type: "action", action: { type: "setBadge", profileId: person.id, badgeId: badge.id, enabled: !held } });
  return <span className="badge-manager-chips">
    {GRANTABLE_ROLES.map((role) => {
      const held = Boolean(person.roles?.includes(role));
      return <button key={role} type="button" className="badge-chip" aria-pressed={held} disabled={busy || (!held && !canGive)}
        onClick={() => toggleRole(role, held)}><RoleBadge role={role} /></button>;
    })}
    {catalog.map((badge) => {
      const held = Boolean(person.badges?.includes(badge.id));
      return <button key={badge.id} type="button" className="badge-chip" aria-pressed={held} disabled={busy || (!held && !canGive)}
        onClick={() => toggleBadge(badge, held)}><CustomBadge badge={badge} /></button>;
    })}
  </span>;
}
