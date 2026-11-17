import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n";
import { BADGE_COLORS, BADGE_ICONS, MAX_BADGE_LABEL, type BadgeIcon } from "./customBadges";
import type { BadgeDefinition, FriendsControls } from "./friendsTypes";
import { CustomBadge } from "./RoleBadge";

const EMPTY: BadgeDefinition = { id: "", label: "", icon: "star", color: "sky" };
const MAX_BADGES = 24;

/** Luft's own badges: create, change, delete. Giving happens on a profile. */
export function FriendsBadgeEditor({ badges, controls, disabled }: { badges: BadgeDefinition[]; controls: FriendsControls; disabled: boolean }) {
  const [draft, setDraft] = useState<BadgeDefinition | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const busy = disabled || controls.pending;
  const label = draft?.label.trim() ?? "";
  return <div className="badge-editor">
    <h3>{t("badges.title")}</h3>
    <p>{t("badges.hint")}</p>
    {!!badges.length && <ul className="badge-editor-list">{badges.map((badge) => <li key={badge.id}>
      <CustomBadge badge={badge} size="md" />
      {confirmDelete === badge.id ? <span className="badge-editor-confirm">
        <button type="button" className="text-button" onClick={() => setConfirmDelete(null)}>{t("friends.cancel")}</button>
        <button type="button" className="text-button danger" disabled={busy}
          onClick={() => controls.send({ type: "action", action: { type: "deleteBadge", id: badge.id } }, () => setConfirmDelete(null))}>{t("badges.delete")}</button>
      </span> : <span>
        <button type="button" className="friends-icon-button" disabled={busy} onClick={() => setDraft({ ...badge })}
          title={t("badges.edit")} aria-label={t("badges.editName", { name: badge.label })}><Pencil size={15} aria-hidden="true" /></button>
        <button type="button" className="friends-icon-button" disabled={busy} onClick={() => setConfirmDelete(badge.id)}
          title={t("badges.delete")} aria-label={t("badges.deleteName", { name: badge.label })}><Trash2 size={15} aria-hidden="true" /></button>
      </span>}
    </li>)}</ul>}

    {draft ? <form className="badge-editor-form" onSubmit={(event) => {
      event.preventDefault();
      if (label && !busy) controls.send({ type: "action", action: { type: "saveBadge", badge: { ...draft, label } } }, () => setDraft(null));
    }}>
      <div className="badge-editor-preview"><CustomBadge badge={{ ...draft, label: label || t("badges.preview") }} size="lg" /></div>
      <label htmlFor="badge-editor-label">{t("badges.name")}</label>
      <input id="badge-editor-label" value={draft.label} maxLength={MAX_BADGE_LABEL} autoComplete="off" disabled={busy}
        placeholder={t("badges.namePlaceholder")} onChange={(event) => { const label = event.currentTarget.value; setDraft((current) => current && { ...current, label }); }} />
      <span className="badge-editor-caption">{t("badges.icon")}</span>
      <div className="badge-editor-icons" role="radiogroup" aria-label={t("badges.icon")}>
        {(Object.entries(BADGE_ICONS) as [BadgeIcon, (typeof BADGE_ICONS)[BadgeIcon]][]).map(([key, Icon]) => <button key={key} type="button" role="radio" aria-checked={draft.icon === key}
          aria-label={t(`badges.iconName.${key}`)} title={t(`badges.iconName.${key}`)} onClick={() => setDraft((current) => current && { ...current, icon: key })}><Icon size={16} aria-hidden="true" /></button>)}
      </div>
      <span className="badge-editor-caption">{t("badges.color")}</span>
      <div className="badge-editor-colors" role="radiogroup" aria-label={t("badges.color")}>
        {BADGE_COLORS.map((color) => <button key={color} type="button" role="radio" aria-checked={draft.color === color}
          data-badge-color={color} aria-label={t(`badges.colorName.${color}`)} title={t(`badges.colorName.${color}`)}
          onClick={() => setDraft((current) => current && { ...current, color })}><i aria-hidden="true" /></button>)}
      </div>
      <div className="badge-editor-actions">
        <button type="button" className="secondary-button" onClick={() => setDraft(null)}>{t("friends.cancel")}</button>
        <button type="submit" className="primary-button" disabled={busy || !label}>{t(draft.id ? "badges.save" : "badges.create")}</button>
      </div>
    </form> : badges.length < MAX_BADGES && <button type="button" className="secondary-button badge-editor-new" disabled={busy} onClick={() => setDraft({ ...EMPTY })}>
      <Plus size={16} aria-hidden="true" />{t("badges.new")}
    </button>}
  </div>;
}
