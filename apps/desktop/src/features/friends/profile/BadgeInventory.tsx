import { ChevronLeft, Minus, Plus } from "lucide-react";
import { t } from "../../../i18n";
import { MAX_SHOWN_BADGES, ownedBadges, shownBadges, type OwnedBadge } from "../badgeInventory";
import { useBadgeCatalog } from "../customBadges";
import type { SocialProfile } from "../friendsTypes";
import { OwnedBadgeView, ownedLabel } from "../RoleBadge";

const label = ownedLabel;
const node = (badge: OwnedBadge) => <OwnedBadgeView owned={badge} size="md" />;

/**
 * Everything the profile owns is its inventory; up to six are shown, in the
 * chosen order. `null` keeps the old behaviour of showing everything.
 */
export function BadgeInventory({ profile, shown, disabled, onChange }: {
  profile: Pick<SocialProfile, "roles" | "badges" | "achievements">;
  shown: string[] | null;
  disabled: boolean;
  onChange: (shown: string[] | null) => void;
}) {
  const owned = ownedBadges(profile, useBadgeCatalog());
  if (!owned.length) return <p className="badge-inventory-empty">{t("badgeInventory.empty")}</p>;
  const visible = shownBadges(owned, shown ?? owned.filter((badge) => badge.kind !== "quest").map((badge) => badge.key)).slice(0, MAX_SHOWN_BADGES);
  const keys = visible.map((badge) => badge.key);
  const stored = owned.filter((badge) => !keys.includes(badge.key));
  const full = keys.length >= MAX_SHOWN_BADGES;
  const set = (next: string[]) => onChange(next);

  return <div className="badge-inventory">
    <fieldset>
      <legend>{t("badgeInventory.shown")} <small>{t("badgeInventory.count", { n: keys.length, max: MAX_SHOWN_BADGES })}</small></legend>
      {visible.length ? <ul className="badge-inventory-list" data-kind="shown">
        {visible.map((badge, index) => <li key={badge.key}>
          {index > 0 && <button type="button" className="badge-inventory-move" disabled={disabled}
            title={t("badgeInventory.forward", { name: label(badge) })} aria-label={t("badgeInventory.forward", { name: label(badge) })}
            onClick={() => set([...keys.slice(0, index - 1), badge.key, keys[index - 1]!, ...keys.slice(index + 1)])}>
            <ChevronLeft size={13} aria-hidden="true" />
          </button>}
          <button type="button" className="badge-inventory-item" disabled={disabled}
            title={t("badgeInventory.hide", { name: label(badge) })} aria-label={t("badgeInventory.hide", { name: label(badge) })}
            onClick={() => set(keys.filter((key) => key !== badge.key))}>
            {node(badge)}<Minus size={13} aria-hidden="true" />
          </button>
        </li>)}
      </ul> : <small className="badge-inventory-note">{t("badgeInventory.noneShown")}</small>}
    </fieldset>
    <fieldset>
      <legend>{t("badgeInventory.inventory")}</legend>
      {stored.length ? <ul className="badge-inventory-list" data-kind="stored">
        {stored.map((badge) => <li key={badge.key}>
          <button type="button" className="badge-inventory-item" disabled={disabled || full}
            title={full ? t("badgeInventory.full", { max: MAX_SHOWN_BADGES }) : t("badgeInventory.show", { name: label(badge) })}
            aria-label={t("badgeInventory.show", { name: label(badge) })}
            onClick={() => set([...keys, badge.key])}>
            {node(badge)}<Plus size={13} aria-hidden="true" />
          </button>
        </li>)}
      </ul> : <small className="badge-inventory-note">{t("badgeInventory.allShown")}</small>}
    </fieldset>
    <div className="badge-inventory-footer">
      <small>{t("badgeInventory.hint")}</small>
      {shown && <button type="button" className="text-button" disabled={disabled} onClick={() => onChange(null)}>{t("badgeInventory.reset")}</button>}
    </div>
  </div>;
}
