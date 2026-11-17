import { AudioLines, EyeOff, Headphones, MessageCircle, Search, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { matchesEveryWord } from "../textMatch";
import { activityOf, friendStatus, isActive } from "./profile/friendStatus";
import { RoleAvatar, RoleBadges } from "./RoleBadge";
import { mainRole } from "./roles";
import { ActivityLine } from "./ActivityLine";
import { ProfileBanner } from "./ProfileBanner";
import { accentColor, nameAttrs, profileLook } from "./appearance";
import { ListenAlongButton } from "./listen-along/ListenAlongButton";
import { alongRelation } from "./listen-along/listenAlong";
import { useFriends } from "./useFriends";
import type { FriendEntry, FriendsControls } from "./friendsTypes";
import type { CSSProperties } from "react";

export function FriendsList({ friends, controls, disabled, onOpen }: {
  friends: FriendEntry[];
  controls: FriendsControls;
  disabled: boolean;
  onOpen: (profileId: string) => void;
}) {
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [query, setQuery] = useState("");
  const online = friends.filter((friend) => isActive(friend, disabled));
  const words = query.trim();
  const visible = [...(onlineOnly ? online : friends)]
    .filter((friend) => !words || matchesEveryWord(words, friend.profile.displayName, friend.profile.friendCode))
    .sort((a, b) =>
    Number(isActive(b, disabled)) - Number(isActive(a, disabled))
    || Number(Boolean(mainRole(b.profile.roles))) - Number(Boolean(mainRole(a.profile.roles)))
    || a.profile.displayName.localeCompare(b.profile.displayName));
  return <section className="friends-panel friends-list" aria-labelledby="friends-list-title">
    <div className="friends-section-heading"><div><h2 id="friends-list-title">{t("friends.listTitle")}<span className="friends-count">{friends.length}</span></h2>
      <p>{disabled ? t("friends.statusUnavailable") : t("friends.onlineCount", { n: online.length })}</p></div>
      {!!friends.length && <div className="friends-list-tools">
        {friends.length > 6 && <label className="friends-list-search"><Search size={14} aria-hidden="true" />
          <input type="search" value={query} maxLength={32} placeholder={t("friends.filterName")} aria-label={t("friends.filterName")}
            onChange={(event) => setQuery(event.currentTarget.value)} /></label>}
        <div className="friends-filters" aria-label={t("friends.filterLabel")}>
          <button type="button" aria-pressed={!onlineOnly} onClick={() => setOnlineOnly(false)}>{t("friends.filterAll")}</button>
          <button type="button" aria-pressed={onlineOnly} onClick={() => setOnlineOnly(true)}>{t("friends.filterOnline")}</button>
        </div>
      </div>}
    </div>
    {!visible.length ? words && friends.length ? <p className="friends-muted">{t("friends.noMatch")}</p>
      : <div className="friends-empty"><Users size={28} aria-hidden="true" /><strong>{t(friends.length ? "friends.noOnline" : "friends.emptyTitle")}</strong>
      <p>{t(friends.length ? "friends.noOnlineHint" : "friends.emptyHint")}</p></div>
      : <ul className="friends-grid">{visible.map((friend, index) =>
        <FriendRow key={friend.profile.id} index={index} friend={friend} controls={controls} disabled={disabled} onOpen={() => onOpen(friend.profile.id)} />)}</ul>}
  </section>;
}

function FriendRow({ friend, index, controls, disabled, onOpen }: { friend: FriendEntry; index: number; controls: FriendsControls; disabled: boolean; onOpen: () => void }) {
  const { profile } = friend;
  const track = disabled ? null : friend.presence.track;
  const look = profileLook(profile);
  const along = alongRelation(useFriends().data, profile.id);
  // Moving pictures and banners only play while the card is pointed at.
  const [hovered, setHovered] = useState(false);
  return <li className="friends-card" data-listening={Boolean(track)} data-role={mainRole(profile.roles)} data-accent={look.accent}
    style={{ "--i": Math.min(index, 12), ...accentColor(look.color) } as CSSProperties}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
    <ProfileBanner profile={profile} className="friends-card-banner" effects={hovered && Boolean(look.bannerMedia)} />
    {friend.listeningHidden && <span className="friends-card-hidden" title={t("friends.listeningHidden")}>
      <EyeOff size={13} aria-hidden="true" /><span className="sr-only">{t("friends.listeningHidden")}</span></span>}
    <button type="button" className="friends-card-main" onClick={onOpen} aria-label={t("friendProfile.open", { name: profile.displayName })}>
      <span className="friends-avatar-presence" data-activity={activityOf(friend, disabled)}>
        <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="lg" frame={look.frame} accent={look.accent}
          color={look.color} motion={look.avatarMedia} animate={hovered} /><i />
      </span>
      <strong className="friends-card-name profile-name" {...nameAttrs(look)}>{profile.displayName}</strong>
      <RoleBadges roles={profile.roles} badges={profile.badges} quests={profile.achievements} shown={profile.style?.shownBadges} limit={3} />
      {along && <span className="friends-card-along" data-along={along}>
        <AudioLines size={12} aria-hidden="true" />{t(along === "listener" ? "listenAlong.cardListener" : "listenAlong.cardFollowing")}
      </span>}
      {track ? <span className="friends-row-track">
        <span className="friends-row-track-art"><AlbumArt title={track.title || ""} image={track.coverUri} size="tiny" /></span>
        <span className="friends-now-playing" aria-hidden="true"><i /><i /><i /></span>
        <small>{track.title || t("listen.untitledTrack")} · {track.artists?.join(", ") || t("listen.unknownArtist")}</small>
      </span> : <ActivityLine activity={activityOf(friend, disabled)} text={friendStatus(friend, disabled)} />}
      {profile.bio && <small className="friends-card-bio">{profile.style?.emoji && <span className="profile-emoji">{profile.style.emoji}</span>}{profile.bio}</small>}
    </button>
    <span className="friends-card-actions">
    <Link className="friends-icon-button" to={`/messages/${profile.id}`} title={t("chat.messageName", { name: profile.displayName })} aria-label={t("chat.messageName", { name: profile.displayName })}>
      <MessageCircle size={17} aria-hidden="true" />
    </Link>
    <ListenAlongButton friend={friend} controls={controls} disabled={disabled} compact />
    <button type="button" className="friends-icon-button friends-invite-button" disabled={disabled || controls.pending}
      onClick={() => controls.send({ type: "invite", profileId: profile.id })}
      title={t("friends.inviteHint")} aria-label={t("friendProfile.inviteName", { name: profile.displayName })}>
      <Headphones size={17} aria-hidden="true" />
    </button>
    </span>
  </li>;
}
