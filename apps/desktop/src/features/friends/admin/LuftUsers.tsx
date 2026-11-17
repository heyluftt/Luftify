import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Eraser, Monitor, Search, ShieldBan, ShieldCheck, Smartphone, UserPen, UserRound } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { t } from "../../../i18n";
import { matchesEveryWord } from "../../textMatch";
import type { FriendsControls, SocialSnapshot } from "../friendsTypes";
import { playedAgo } from "../profile/friendsTime";
import { RoleAvatar } from "../RoleBadge";
import { ADMIN_QUERY_KEY, compareVersions, megabytes, newestVersion, type AdminUser } from "./adminApi";
import { BadgeChips } from "./BadgeChips";

type Filter = "all" | "online" | "outdated" | "suspended";
type Confirm = { id: string; moderation: "clearProfile" | "suspend" | "resetName" } | null;

/** Every profile on the server: who, how active, which version; badges and moderation per person. */
export function LuftUsers({ users, snapshot, controls, disabled, focusId, onOpen }: {
  users: AdminUser[];
  snapshot: SocialSnapshot;
  controls: FriendsControls;
  disabled: boolean;
  focusId: string | null;
  onOpen: (profileId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(focusId);
  useEffect(() => { if (focusId) setOpenId(focusId); }, [focusId]);
  const deferred = useDeferredValue(query.trim());
  const newest = newestVersion(users);
  const outdated = (user: AdminUser) => Boolean(newest && user.appVersion && compareVersions(user.appVersion, newest) < 0);
  const counts: Record<Filter, number> = {
    all: users.length,
    online: users.filter((user) => user.online).length,
    outdated: users.filter(outdated).length,
    suspended: users.filter((user) => user.suspended).length,
  };
  const shown = users
    .filter((user) => filter === "all" || (filter === "online" ? user.online : filter === "outdated" ? outdated(user) : user.suspended))
    .filter((user) => !deferred || matchesEveryWord(deferred, user.profile.displayName, user.profile.friendCode))
    // Online first, then the most recently seen.
    .sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0));

  return <section className="luft-users" aria-labelledby="luft-users-title">
    <div className="luft-users-head">
      <div><h3 id="luft-users-title">{t("luftAdmin.users")}</h3><p>{t("luftAdmin.usersHint")}</p></div>
      <label className="shared-queue-filter"><Search size={15} aria-hidden="true" />
        <input value={query} maxLength={40} placeholder={t("luftAdmin.search")} aria-label={t("luftAdmin.search")} onChange={(event) => setQuery(event.currentTarget.value)} />
      </label>
    </div>
    <div className="luft-users-filters" role="radiogroup" aria-label={t("luftAdmin.users")}>
      {(["all", "online", "outdated", "suspended"] as const).map((key) => <button key={key} type="button" role="radio" aria-checked={filter === key}
        disabled={key !== "all" && !counts[key]} onClick={() => setFilter(key)}>
        {t(`luftAdmin.filter.${key}`)}<small>{counts[key]}</small>
      </button>)}
    </div>
    {shown.length ? <ul className="luft-users-list">
      {shown.map((user) => <UserRow key={user.profile.id} user={user} snapshot={snapshot} controls={controls} disabled={disabled}
        outdated={outdated(user)} open={openId === user.profile.id} focused={focusId === user.profile.id}
        onToggle={() => setOpenId(openId === user.profile.id ? null : user.profile.id)} onOpen={onOpen} />)}
    </ul> : <p className="friends-muted">{t("luftAdmin.none")}</p>}
  </section>;
}

function UserRow({ user, snapshot, controls, disabled, outdated, open, focused, onToggle, onOpen }: {
  user: AdminUser;
  snapshot: SocialSnapshot;
  controls: FriendsControls;
  disabled: boolean;
  outdated: boolean;
  open: boolean;
  focused: boolean;
  onToggle: () => void;
  onOpen: (profileId: string) => void;
}) {
  const client = useQueryClient();
  const row = useRef<HTMLLIElement>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  useEffect(() => { if (focused) row.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focused]);
  const { profile } = user;
  const own = profile.id === snapshot.me.id;
  const friend = snapshot.friends.some((entry) => entry.profile.id === profile.id);
  const luft = profile.roles?.includes("luft");
  const status = user.online ? t(user.listening ? "luftAdmin.listening" : "luftAdmin.online")
    : user.lastSeenMs ? t("luftAdmin.lastSeen", { when: playedAgo(user.lastSeenMs) }) : t("luftAdmin.neverSeen");
  const moderate = (moderation: "clearProfile" | "suspend" | "unsuspend" | "resetName") => controls.send(
    { type: "action", action: { type: "moderate", profileId: profile.id, moderation } },
    () => { setConfirm(null); void client.invalidateQueries({ queryKey: ADMIN_QUERY_KEY }); },
  );
  const busy = disabled || controls.pending;

  return <li ref={row} className="luft-user" data-open={open || undefined} data-suspended={user.suspended || undefined} data-focused={focused || undefined}>
    <button type="button" className="luft-user-main" aria-expanded={open} onClick={onToggle}>
      <span className="friends-avatar-presence" data-activity={user.online ? "online" : "offline"}>
        <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="sm" /><i />
      </span>
      <span className="luft-user-copy">
        <strong>{profile.displayName}{own && <em> · {t("friends.you")}</em>}</strong>
        <small>{profile.friendCode} · {status}</small>
      </span>
      <span className="luft-user-facts">
        {user.suspended && <span className="luft-tag" data-tone="danger">{t("luftAdmin.suspended")}</span>}
        {user.appVersion && <span className="luft-tag" data-tone={outdated ? "warning" : undefined} title={outdated ? t("luftAdmin.outdated") : t("luftAdmin.pcVersion")}>
          <Monitor size={12} aria-label={t("luftAdmin.pcVersion")} />{user.appVersion}
        </span>}
        {user.phoneVersion && <span className="luft-tag" title={t("luftAdmin.phoneVersion")}>
          <Smartphone size={12} aria-label={t("luftAdmin.phoneVersion")} />{user.phoneVersion}
        </span>}
        <small>{user.friends === 1 ? t("luftAdmin.friendsOne") : t("luftAdmin.friends", { n: user.friends })}</small>
      </span>
      <ChevronDown className="luft-user-chevron" size={16} aria-hidden="true" />
    </button>
    {open && <div className="luft-user-detail">
      <div className="luft-user-stats">
        <small>{profile.achievements?.length === 1 ? t("luftAdmin.achievementsOne") : t("luftAdmin.achievements", { n: profile.achievements?.length ?? 0 })}</small>
        <small>{t("luftAdmin.media", { n: megabytes(user.mediaBytes) })}</small>
      </div>
      <BadgeChips person={profile} canGive={own || friend} catalog={snapshot.badges ?? []} controls={controls} disabled={disabled} />
      {!own && !friend && <small className="friends-muted">{t("luftAdmin.notFriend")}</small>}
      <div className="luft-user-actions">
        {friend && <button type="button" className="secondary-button" onClick={() => onOpen(profile.id)}><UserRound size={15} aria-hidden="true" />{t("luftAdmin.openProfile")}</button>}
        {!own && !luft && <>
          <span className="luft-user-actions-label">{t("luftAdmin.moderation")}</span>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirm({ id: profile.id, moderation: "resetName" })}>
            <UserPen size={15} aria-hidden="true" />{t("luftAdmin.resetName")}
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirm({ id: profile.id, moderation: "clearProfile" })}>
            <Eraser size={15} aria-hidden="true" />{t("luftAdmin.clear")}
          </button>
          {user.suspended
            ? <button type="button" className="secondary-button" disabled={busy} onClick={() => moderate("unsuspend")}><ShieldCheck size={15} aria-hidden="true" />{t("luftAdmin.unsuspend")}</button>
            : <button type="button" className="secondary-button danger" disabled={busy} onClick={() => setConfirm({ id: profile.id, moderation: "suspend" })}>
              <ShieldBan size={15} aria-hidden="true" />{t("luftAdmin.suspend")}
            </button>}
        </>}
      </div>
      {confirm && <div className="friends-confirm" role="group" aria-label={t("friends.confirmAction")}>
        <p>{t(confirm.moderation === "suspend" ? "luftAdmin.suspendConfirm" : confirm.moderation === "resetName" ? "luftAdmin.resetNameConfirm" : "luftAdmin.clearConfirm", { name: profile.displayName })}</p>
        <div><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirm(null)}>{t("friends.cancel")}</button>
          <button type="button" className="secondary-button danger" disabled={busy} onClick={() => moderate(confirm.moderation)}>{t("luftAdmin.confirm")}</button></div>
      </div>}
    </div>}
  </li>;
}
