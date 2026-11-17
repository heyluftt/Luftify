import { LogOut } from "lucide-react";
import { t } from "../../i18n";
import type { ListenTogetherStatus } from "./listenTogetherTypes";
import { RoleAvatar, RoleBadges } from "../friends/RoleBadge";

export function ListenPeoplePanel({ status, leaving, onLeave }: {
  status: ListenTogetherStatus;
  leaving: boolean;
  onLeave: () => void;
}) {
  // Host first, then you, then everyone else by name.
  const people = [...status.participants].sort((left, right) =>
    Number(right.isHost) - Number(left.isHost)
    || Number(right.id === status.youId) - Number(left.id === status.youId)
    || left.displayName.localeCompare(right.displayName));
  return <section className="listen-panel listen-people-panel" aria-labelledby="listen-people-title">
    <div className="listen-panel-heading"><h2 id="listen-people-title">{t("listen.participants")}</h2>
      <span className="listen-count">{people.length} / 8</span></div>
    <ul className="listen-together-people">{people.map((person) =>
      <li key={person.id} data-connected={person.connected}>
        <RoleAvatar name={person.displayName} uri={person.avatarUri} roles={person.roles} />
        <span className="listen-person-copy">
          <span className="listen-person-name"><strong>{person.displayName}</strong><RoleBadges roles={person.roles} badges={person.badges} limit={2} /></span>
          <small>
            {t(person.isHost ? "listen.host" : "listen.guest")}
            {!person.connected && <> · {t("listen.offlineBadge")}</>}
          </small>
        </span>
        {person.id === status.youId && <span className="listen-person-badge">{t("listen.youBadge")}</span>}
      </li>)}</ul>
    <button type="button" className="secondary-button listen-leave" disabled={leaving} onClick={onLeave}>
      <LogOut size={16} aria-hidden="true" />{t(leaving ? "listen.leaving" : "listen.leave")}
    </button>
  </section>;
}
