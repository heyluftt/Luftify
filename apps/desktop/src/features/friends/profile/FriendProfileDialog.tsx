import { Check, Copy, Eye, EyeOff, Headphones, MessageCircle, ShieldBan, UserRoundMinus, Wind } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../../i18n";
import { ActivityLine } from "../ActivityLine";
import type { FriendEntry, FriendsControls, SocialProfile } from "../friendsTypes";
import { managesRoles } from "../roles";
import { canListenAlong } from "../listen-along/listenAlong";
import { ListenAlongButton } from "../listen-along/ListenAlongButton";
import { FriendListening } from "./FriendListening";
import { activityOf, presenceStatus } from "./friendStatus";
import { friendsSince } from "./friendsTime";
import { ProfileMenu, type ProfileMenuItem } from "./ProfileMenu";
import { ProfileSheet } from "./ProfileSheet";

export function FriendProfileDialog({ friend, me, controls, offline, error, onManage, onClose }: {
  friend: FriendEntry;
  me: SocialProfile;
  controls: FriendsControls;
  offline: boolean;
  error: string | undefined;
  /** Luft only: jump to this person in the badge manager. */
  onManage: () => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState<"removeFriend" | "block" | null>(null);
  const [invited, setInvited] = useState(false);
  const [copied, setCopied] = useState(false);
  const { profile } = friend;
  const navigate = useNavigate();
  const busy = offline || controls.pending;
  const glow = offline ? undefined : (friend.presence.track ?? friend.recent?.[0]?.track)?.coverUri;
  const activity = activityOf(friend, offline);

  const menu: ProfileMenuItem[] = [
    { icon: copied ? Check : Copy, label: t(copied ? "friends.copied" : "friends.copyCode"), onSelect: () => {
      void navigator.clipboard.writeText(profile.friendCode).then(() => setCopied(true), () => setCopied(false));
    } },
    ...(managesRoles(me) ? [{ icon: Wind, label: t("badges.manageFor", { name: profile.displayName }), onSelect: onManage }] : []),
    { icon: friend.listeningHidden ? Eye : EyeOff, label: t(friend.listeningHidden ? "friends.listeningShare" : "friends.listeningHide", { name: profile.displayName }), disabled: busy,
      onSelect: () => controls.send({ type: "action", action: { type: "setListeningHidden", profileId: profile.id, hidden: !friend.listeningHidden } }) },
    { icon: UserRoundMinus, label: t("friends.remove"), disabled: busy, onSelect: () => setConfirm("removeFriend") },
    { icon: ShieldBan, label: t("friends.block"), danger: true, disabled: busy, onSelect: () => setConfirm("block") },
  ];

  return <ProfileSheet profile={profile} activity={activity} glow={glow} onClose={onClose}
    status={<ActivityLine activity={activity} text={presenceStatus(friend, offline)} />}
    footer={(friend.sinceMs || friend.listeningHidden) ? <>
      {friend.sinceMs ? <small>{t("friendProfile.since", { date: friendsSince(friend.sinceMs) })}</small> : null}
      {friend.listeningHidden && <small className="friend-profile-hidden"><EyeOff size={13} aria-hidden="true" />{t("friends.listeningHidden")}</small>}
    </> : undefined}
    actions={<>
      <div className="friend-profile-actions">
        <button type="button" className="secondary-button" onClick={() => { onClose(); navigate(`/messages/${profile.id}`); }}>
          <MessageCircle size={16} aria-hidden="true" />{t("chat.message")}
        </button>
        <ListenAlongButton friend={friend} controls={controls} disabled={offline} />
        <button type="button" className={canListenAlong(friend, offline) ? "secondary-button" : "primary-button"} disabled={busy}
          title={t("friendProfile.invite")} aria-label={t(invited ? "friendProfile.invited" : "friendProfile.invite")}
          onClick={() => controls.send({ type: "invite", profileId: profile.id }, () => setInvited(true))}>
          {invited ? <Check size={16} aria-hidden="true" /> : <Headphones size={16} aria-hidden="true" />}
          {t(invited ? "friendProfile.invited" : "friendProfile.inviteShort")}
        </button>
        <ProfileMenu items={menu} />
      </div>
      {error && <p className="friends-inline-error friend-profile-error" role="alert">{error}</p>}
      {confirm && <div className="friends-confirm" role="group" aria-label={t("friends.confirmAction")}>
        <p>{t(confirm === "block" ? "friends.blockConfirm" : "friends.removeConfirm", { name: profile.displayName })}</p>
        <div><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirm(null)}>{t("friends.cancel")}</button>
          <button type="button" className="secondary-button danger" disabled={busy}
            onClick={() => controls.send({ type: "action", action: { type: confirm, profileId: profile.id } }, onClose)}>
            {t(confirm === "block" ? "friends.block" : "friends.remove")}
          </button></div>
      </div>}
    </>}>
    <FriendListening friend={friend} offline={offline} />
  </ProfileSheet>;
}
