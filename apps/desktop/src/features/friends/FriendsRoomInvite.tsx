import { Link } from "react-router-dom";
import { useState } from "react";
import { Check, Headphones, Users } from "lucide-react";
import { t } from "../../i18n";
import { activityOf, friendStatus, isActive } from "./profile/friendStatus";
import { RoleAvatar } from "./RoleBadge";
import { friendsErrorText, useFriends, useFriendsControls } from "./useFriends";

const COLLAPSED = 5;

/** Invite friends straight from the room, online friends first. */
export function FriendsRoomInvite() {
  const query = useFriends();
  const { controls, mutation } = useFriendsControls();
  const [invited, setInvited] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const offline = query.data?.connection !== "online";
  const friends = [...(query.data?.snapshot?.friends ?? [])].sort((a, b) =>
    Number(isActive(b, offline)) - Number(isActive(a, offline)) || a.profile.displayName.localeCompare(b.profile.displayName));
  const shown = all ? friends : friends.slice(0, COLLAPSED);
  return <section className="listen-panel friends-room-invite">
    <div className="friends-section-heading"><h2>{t("friends.inviteFriends")}</h2><Users size={20} aria-hidden="true" /></div>
    {friends.length ? <>
      <ul className="friends-room-people">{shown.map((friend) => {
        const sent = invited.includes(friend.profile.id);
        return <li key={friend.profile.id}>
          <span className="friends-avatar-presence" data-activity={activityOf(friend, offline)}>
            <RoleAvatar name={friend.profile.displayName} uri={friend.profile.avatarUri} roles={friend.profile.roles} size="sm" /><i />
          </span>
          <span className="friends-person-copy"><strong>{friend.profile.displayName}</strong><small>{friendStatus(friend, offline)}</small></span>
          <button type="button" className="friends-icon-button" data-sent={sent || undefined} disabled={offline || controls.pending || sent}
            title={t(sent ? "friendProfile.invited" : "friendProfile.inviteName", { name: friend.profile.displayName })}
            aria-label={t(sent ? "friendProfile.invited" : "friendProfile.inviteName", { name: friend.profile.displayName })}
            onClick={() => controls.send({ type: "invite", profileId: friend.profile.id }, () => setInvited((ids) => [...ids, friend.profile.id]))}>
            {sent ? <Check size={16} aria-hidden="true" /> : <Headphones size={16} aria-hidden="true" />}
          </button>
        </li>;
      })}</ul>
      {friends.length > COLLAPSED && <button type="button" className="text-button" onClick={() => setAll(!all)}>
        {t(all ? "friendProfile.showLess" : "friendProfile.showAll", { n: friends.length })}
      </button>}
      {mutation.isError && <p className="friends-action-feedback" role="alert">{friendsErrorText(mutation.error)}</p>}
    </> : <p>{t("friends.roomFriendsHint")}</p>}
    <Link className="text-button" to="/friends">{t("friends.openFriends")}</Link>
  </section>;
}
