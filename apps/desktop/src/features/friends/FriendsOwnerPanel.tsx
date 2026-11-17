import { Wind } from "lucide-react";
import { useState } from "react";
import { t, type MessageKey } from "../../i18n";
import { ProblemReportsInbox } from "../problem-report/ProblemReportsInbox";
import type { FriendsControls, SocialSnapshot } from "./friendsTypes";
import { useAdminOverview } from "./admin/adminApi";
import { LuftLog } from "./admin/LuftLog";
import { LuftServer } from "./admin/LuftServer";
import { LuftStats } from "./admin/LuftStats";
import { LuftTools } from "./admin/LuftTools";
import { LuftUsers } from "./admin/LuftUsers";
import { RoleAvatar, RoleBadges } from "./RoleBadge";
import { managesRoles } from "./roles";

type Part = "overview" | "users" | "reports" | "tools" | "log";
const PARTS: Part[] = ["overview", "users", "reports", "tools", "log"];

/**
 * Luft's corner, in parts: the server at a glance, every user, reports,
 * tools (sign-ups, announcement, backup, code, badges) and the admin log.
 * Developers see the numbers and the team.
 */
export function FriendsOwnerPanel({ snapshot, controls, disabled, focusId, onOpen }: {
  snapshot: SocialSnapshot;
  controls: FriendsControls;
  disabled: boolean;
  /** A person whose badges Luft asked to manage from their profile. */
  focusId: string | null;
  onOpen: (profileId: string) => void;
}) {
  const luft = managesRoles(snapshot.me);
  const [part, setPart] = useState<Part>(focusId ? "users" : "overview");
  const server = snapshot.server;
  const admin = useAdminOverview(luft && !disabled);
  if (!luft && !server) return null;
  const friendIds = new Set(snapshot.friends.map((friend) => friend.profile.id));
  const shown = focusId && part === "overview" ? "users" : part;

  if (!luft) {
    return <section className="friends-panel friends-owner" data-role="dev" aria-labelledby="friends-owner-title">
      <div className="friends-section-heading"><div><h2 id="friends-owner-title">{t("roles.devTitle")}</h2><p>{t("roles.devHint2")}</p></div><Wind size={21} aria-hidden="true" /></div>
      <LuftStats server={server} admin={undefined} />
      {!!server?.team.length && <div className="friends-owner-team">
        <h3>{t("roles.team")}</h3>
        <ul>{server.team.map((person) => {
          const content = <>
            <RoleAvatar name={person.displayName} uri={person.avatarUri} roles={person.roles} size="sm" />
            <span className="friends-person-copy"><strong>{person.displayName}</strong><RoleBadges roles={person.roles} badges={person.badges} /></span>
          </>;
          return <li key={person.id}>{friendIds.has(person.id)
            ? <button type="button" onClick={() => onOpen(person.id)} aria-label={t("friendProfile.open", { name: person.displayName })}>{content}</button>
            : <div>{content}</div>}</li>;
        })}</ul>
      </div>}
    </section>;
  }

  const counts: Partial<Record<Part, number | undefined>> = {
    users: admin.data?.users.length,
    reports: admin.data?.server?.reports,
  };
  return <section className="friends-panel friends-owner luft-panel" data-role="luft" aria-labelledby="friends-owner-title">
    <div className="friends-section-heading"><div><h2 id="friends-owner-title">{t("roles.ownerTitle")}</h2><p>{t("roles.ownerHint")}</p></div><Wind size={21} aria-hidden="true" /></div>
    <div className="luft-parts" role="tablist" aria-label={t("roles.ownerTitle")}>
      {PARTS.map((key) => <button key={key} type="button" role="tab" aria-selected={shown === key} onClick={() => setPart(key)}>
        {t(`luftAdmin.part.${key}` as MessageKey)}{counts[key] ? <small>{counts[key]}</small> : null}
      </button>)}
    </div>
    {admin.isError && <p className="friends-muted" role="status">{t("luftAdmin.unavailable")}</p>}
    {shown === "overview" && <div className="luft-part">
      <LuftStats server={server} admin={admin.data} />
      {admin.data && <LuftServer admin={admin.data} />}
    </div>}
    {shown === "users" && admin.data && <LuftUsers users={admin.data.users} snapshot={snapshot} controls={controls} disabled={disabled} focusId={focusId} onOpen={onOpen} />}
    {shown === "reports" && <ProblemReportsInbox disabled={disabled} />}
    {shown === "tools" && <LuftTools admin={admin.data} snapshot={snapshot} controls={controls} disabled={disabled} />}
    {shown === "log" && <LuftLog log={admin.data?.log ?? (admin.data?.server ? [] : undefined)} />}
  </section>;
}
