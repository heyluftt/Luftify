import { t, type MessageKey } from "../../../i18n";
import type { ServerOverview } from "../friendsTypes";
import { compareVersions, megabytes, type AdminOverview } from "./adminApi";

/** The server at a glance: people, activity, rooms, storage and app versions. */
export function LuftStats({ server, admin }: { server: ServerOverview | null | undefined; admin: AdminOverview | undefined }) {
  const stats: { label: MessageKey; value: number }[] = server ? [
    { label: "roles.stats.profiles", value: server.profiles },
    { label: "roles.stats.online", value: server.online },
    { label: "roles.stats.listening", value: server.listening },
    { label: "roles.stats.rooms", value: admin?.rooms ?? server.rooms },
  ] : [];
  const versions = new Map<string, number>();
  for (const user of admin?.users ?? []) if (user.appVersion) versions.set(user.appVersion, (versions.get(user.appVersion) ?? 0) + 1);
  const sorted = [...versions].sort(([a], [b]) => compareVersions(b, a));
  const used = admin ? megabytes(admin.mediaBytes) : 0;
  const share = admin ? Math.min(1, admin.mediaBytes / Math.max(1, admin.mediaLimitBytes)) : 0;

  return <div className="luft-stats">
    {!!stats.length && <dl className="friends-owner-stats">{stats.map((stat) => <div key={stat.label}>
      <dt>{t(stat.label)}</dt><dd>{stat.value.toLocaleString()}</dd>
    </div>)}</dl>}
    {admin && <div className="luft-stats-row">
      <div className="luft-stat-card">
        <span>{t("luftAdmin.storage")}</span>
        <strong>{t("luftAdmin.storageValue", { used, max: megabytes(admin.mediaLimitBytes) })}</strong>
        <i className="luft-meter" data-high={share > .8 || undefined}><b style={{ width: `${share * 100}%` }} /></i>
      </div>
      <div className="luft-stat-card">
        <span>{t("luftAdmin.versions")}</span>
        {sorted.length ? <span className="luft-versions">{sorted.map(([version, count], index) => <span key={version} className="luft-tag"
          data-tone={index > 0 ? "warning" : undefined}>{version}<small>× {count}</small></span>)}</span>
          : <small className="friends-muted">{t("luftAdmin.noVersions")}</small>}
      </div>
    </div>}
  </div>;
}
