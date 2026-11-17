import { Archive, Database, DoorClosed, DoorOpen, Headphones, MessageSquareWarning, Server, ShieldBan, Timer } from "lucide-react";
import { t } from "../../../i18n";
import { formatListeningTime } from "../../analytics/analyticsFormatting";
import { playedAgo } from "../profile/friendsTime";
import { megabytes, type AdminOverview } from "./adminApi";

/** How the server itself is doing: running since, version, database, rooms, reports, sign-ups. */
export function LuftServer({ admin }: { admin: AdminOverview }) {
  const server = admin.server;
  if (!server) return <p className="friends-muted">{t("luftAdmin.serverOld")}</p>;
  const suspended = admin.users.filter((user) => user.suspended).length;
  const facts = [
    { icon: Timer, label: t("luftAdmin.running"), value: server.startedAtMs ? formatListeningTime(Date.now() - server.startedAtMs) : "—" },
    { icon: Server, label: t("luftAdmin.version"), value: server.version || "—" },
    { icon: Database, label: t("luftAdmin.database"), value: t("luftAdmin.mb", { n: megabytes(server.databaseBytes) }) },
    ...(server.backups === undefined ? [] : [{
      icon: Archive,
      label: t("luftAdmin.autoBackup"),
      value: server.lastBackupMs ? t("luftAdmin.autoBackupValue", { when: playedAgo(server.lastBackupMs), n: server.backups }) : t("luftAdmin.autoBackupNone"),
      // More than a day and a half without a copy: something is off.
      warn: !server.lastBackupMs || Date.now() - server.lastBackupMs > 36 * 3_600_000,
    }]),
    { icon: Headphones, label: t("luftAdmin.inRooms"), value: t("luftAdmin.inRoomsValue", { people: server.roomMembers, rooms: admin.rooms }) },
    { icon: MessageSquareWarning, label: t("luftAdmin.openReports"), value: String(server.reports) },
    { icon: ShieldBan, label: t("luftAdmin.suspendedCount"), value: String(suspended) },
    {
      icon: server.settings.signupsOpen ? DoorOpen : DoorClosed,
      label: t("luftAdmin.signups"),
      value: t(server.settings.signupsOpen ? "luftAdmin.signupsOpen" : "luftAdmin.signupsClosed"),
      warn: !server.settings.signupsOpen,
    },
  ];
  return <section className="luft-server" aria-labelledby="luft-server-title">
    <h3 id="luft-server-title">{t("luftAdmin.server")}</h3>
    <dl>{facts.map((fact) => <div key={fact.label} data-warn={fact.warn || undefined}>
      <dt><fact.icon size={14} aria-hidden="true" />{fact.label}</dt>
      <dd>{fact.value}</dd>
    </div>)}</dl>
    {server.settings.announcement && <p className="luft-server-announcement"><strong>{t("luftAdmin.announcementLive")}</strong>{server.settings.announcement}</p>}
  </section>;
}
