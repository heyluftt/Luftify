import { AudioLines, Check, Copy, Eye, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { serverHost } from "../listen-together/listenTexts";
import type { FriendsControls, FriendsStatus, SocialSnapshot } from "./friendsTypes";
import { ACHIEVEMENTS } from "./achievements/achievements";
import { accentColor, nameAttrs, profileLook } from "./appearance";
import { listenersText } from "./listen-along/listenAlong";
import { isActive } from "./profile/friendStatus";
import { PresenceModePicker } from "./PresenceModePicker";
import { ProfileBanner } from "./ProfileBanner";
import { ProfileSong } from "./ProfileSong";
import { RoleAvatar, RoleBadges } from "./RoleBadge";
import { isCustomCode, mainRole } from "./roles";

/** Your profile across the top of the friends page, with your code and a few numbers. */
export function FriendsHero({ status, snapshot, controls, refreshing, onView, onEdit, onRefresh }: {
  status: FriendsStatus;
  snapshot: SocialSnapshot;
  controls: FriendsControls;
  refreshing: boolean;
  onView: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const { me } = snapshot;
  const online = status.connection === "online";
  const look = profileLook(me);
  const listeners = listenersText(snapshot);
  const facts = [
    { label: t("friends.factFriends"), value: snapshot.friends.length },
    { label: t("friends.factOnline"), value: online ? snapshot.friends.filter((friend) => isActive(friend, false)).length : 0 },
    { label: t("friends.factAchievements"), value: `${me.achievements?.length ?? 0}/${ACHIEVEMENTS.length}` },
  ];
  return <section className="friends-hero" data-role={mainRole(me.roles)} data-accent={look.accent} data-banner={look.banner ? "" : undefined}
    style={accentColor(look.color)} aria-labelledby="friends-hero-name">
    {look.banner ? <ProfileBanner profile={me} className="friends-hero-banner" /> : <div className="friends-hero-glow" aria-hidden="true" />}
    <button type="button" className="friends-hero-avatar" onClick={onView} aria-label={t("ownProfile.view")}>
      <RoleAvatar name={me.displayName} uri={me.avatarUri} roles={me.roles} size="xl" frame={look.frame} accent={look.accent} color={look.color} motion={look.avatarMedia} animate />
    </button>
    <div className="friends-hero-copy">
      <h2 id="friends-hero-name" className="profile-name" {...nameAttrs(look)}>{me.displayName}</h2>
      <div className="friends-hero-meta">
        <RoleBadges roles={me.roles} badges={me.badges} quests={me.achievements} shown={me.style?.shownBadges} size="md" />
        <PresenceModePicker options={snapshot.options} controls={controls} disabled={!online} />
      </div>
      {me.bio ? <p className="friends-hero-bio">{look.emoji && <span className="profile-emoji">{look.emoji}</span>}{me.bio}</p>
        : <button type="button" className="text-button friends-hero-bio-empty" disabled={!online} onClick={onEdit}>{t("ownProfile.addStatus")}</button>}
      {listeners && <p className="friends-hero-listeners"><AudioLines size={14} aria-hidden="true" />{listeners}</p>}
      {me.favorite && <ProfileSong track={me.favorite} accent={look.accent} color={look.color} />}
      <div className="friends-hero-actions">
        <button type="button" className="primary-button" disabled={!online} onClick={onEdit}><Pencil size={15} aria-hidden="true" />{t("ownProfile.edit")}</button>
        <button type="button" className="secondary-button" onClick={onView}><Eye size={15} aria-hidden="true" />{t("ownProfile.view")}</button>
      </div>
    </div>
    <aside className="friends-hero-side">
      <FriendCode code={me.friendCode} />
      <dl className="friends-hero-facts">{facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
      <p className="friends-hero-server">
        <span className="friends-connection" data-online={online} title={serverHost(status.serverUrl)}><i />{t(online ? "friends.connected" : "friends.disconnected")}</span>
        <button type="button" className="friends-icon-button" disabled={refreshing || controls.pending} onClick={onRefresh}
          title={t("friends.refresh")} aria-label={t("friends.refresh")}><RefreshCw size={15} aria-hidden="true" /></button>
      </p>
    </aside>
  </section>;
}

/** Your friend code to pass on, copied with one click. */
function FriendCode({ code }: { code: string }) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  useEffect(() => { setCopied(null); }, [code]);
  // The tick goes back to the copy icon after a moment.
  useEffect(() => {
    if (copied !== "copied") return;
    const timer = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const custom = isCustomCode(code);
  const copyLabel = t(copied === "copied" ? "friends.copied" : "friends.copyCode");
  return <>
    <button type="button" className="friends-code" data-custom={custom || undefined} title={copyLabel}
      onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied("copied"); } catch { setCopied("failed"); } }}>
      <span><small>{custom && <Sparkles size={12} aria-hidden="true" />}{t(custom ? "roles.customCode" : "friends.yourCode")}</small>
        <strong className={custom ? "role-code" : undefined}>{code}</strong></span>
      {copied === "copied" ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
    </button>
    {copied === "failed" && <small className="friends-copy-feedback" role="alert">{t("friends.copyFailed")}</small>}
  </>;
}
