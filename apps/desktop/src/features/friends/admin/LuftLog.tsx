import { Award, DatabaseBackup, DoorOpen, Eraser, Hash, Megaphone, ShieldBan, ShieldCheck, Tag, UserPen, type LucideIcon } from "lucide-react";
import { t, type MessageKey } from "../../../i18n";
import { playedAgo } from "../profile/friendsTime";
import type { AdminLogEntry } from "./adminApi";

const ICONS: Record<string, LucideIcon> = {
  suspend: ShieldBan, unsuspend: ShieldCheck, clearProfile: Eraser, resetName: UserPen, role: Award, badge: Tag,
  badgeSaved: Tag, badgeDeleted: Tag, code: Hash, signups: DoorOpen, announcement: Megaphone, backup: DatabaseBackup,
};

/** Every admin action, newest first: who did what to whom, and when. */
export function LuftLog({ log }: { log: AdminLogEntry[] | undefined }) {
  if (!log) return <p className="friends-muted">{t("luftAdmin.serverOld")}</p>;
  if (!log.length) return <p className="friends-muted">{t("luftAdmin.logEmpty")}</p>;
  return <ol className="luft-log">
    {log.map((entry, index) => {
      const Icon = ICONS[entry.action] ?? Tag;
      const known = entry.action in ICONS;
      return <li key={`${entry.atMs}-${index}`} data-action={entry.action}>
        <span className="luft-log-icon" aria-hidden="true"><Icon size={15} /></span>
        <span className="luft-log-copy">
          <strong>{known ? t(`luftAdmin.log.${entry.action}` as MessageKey) : entry.action}{entry.target ? ` · ${entry.target}` : ""}</strong>
          {entry.detail && <small>{entry.detail}</small>}
        </span>
        <time dateTime={new Date(entry.atMs).toISOString()} title={new Date(entry.atMs).toLocaleString()}>{playedAgo(entry.atMs)}</time>
      </li>;
    })}
  </ol>;
}
