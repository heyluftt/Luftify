import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, DoorClosed, Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import { FriendsBadgeEditor } from "../FriendsBadgeEditor";
import type { FriendsControls, ServerSettings, SocialSnapshot } from "../friendsTypes";
import { friendsErrorText } from "../useFriends";
import { ADMIN_QUERY_KEY, adminBackup, type AdminOverview } from "./adminApi";
import { LuftCodeForm } from "./LuftCodeForm";

const MAX_ANNOUNCEMENT = 200;

/**
 * Luft's switches and safety net: sign-ups, a line for everyone, a backup of
 * the server database, the custom code and the badges.
 */
export function LuftTools({ admin, snapshot, controls, disabled }: {
  admin: AdminOverview | undefined;
  snapshot: SocialSnapshot;
  controls: FriendsControls;
  disabled: boolean;
}) {
  const client = useQueryClient();
  const settings = admin?.server?.settings;
  const [text, setText] = useState(settings?.announcement ?? "");
  useEffect(() => { setText(settings?.announcement ?? ""); }, [settings?.announcement]);
  const busy = disabled || controls.pending || !settings;
  const save = (next: ServerSettings) => controls.send({ type: "action", action: { type: "setServerSettings", settings: next } },
    () => void client.invalidateQueries({ queryKey: ADMIN_QUERY_KEY }));
  const backup = useMutation({ mutationFn: adminBackup, onSuccess: () => void client.invalidateQueries({ queryKey: ADMIN_QUERY_KEY }) });
  const changed = (text.trim() || null) !== (settings?.announcement ?? null);

  return <div className="luft-tools">
    <section className="luft-tool">
      <header><DoorClosed size={18} aria-hidden="true" /><div><h3>{t("luftAdmin.signups")}</h3><p>{t("luftAdmin.signupsHint")}</p></div></header>
      <label className="own-profile-toggle">
        <strong>{t(settings?.signupsOpen === false ? "luftAdmin.signupsClosed" : "luftAdmin.signupsOpen")}</strong>
        <span className="switch"><input type="checkbox" checked={settings?.signupsOpen ?? true} disabled={busy}
          onChange={(event) => settings && save({ ...settings, signupsOpen: event.currentTarget.checked })} /><span /></span>
      </label>
    </section>

    <section className="luft-tool">
      <header><Megaphone size={18} aria-hidden="true" /><div><h3>{t("luftAdmin.announcement")}</h3><p>{t("luftAdmin.announcementHint")}</p></div></header>
      <form onSubmit={(event) => { event.preventDefault(); if (settings && changed) save({ ...settings, announcement: text.trim() || null }); }}>
        <textarea value={text} maxLength={MAX_ANNOUNCEMENT} rows={2} disabled={busy} placeholder={t("luftAdmin.announcementPlaceholder")}
          aria-label={t("luftAdmin.announcement")} onChange={(event) => setText(event.currentTarget.value.replace(/\n/g, " "))} />
        <div className="luft-tool-actions">
          <small>{t("report.left", { n: MAX_ANNOUNCEMENT - text.length })}</small>
          {settings?.announcement && <button type="button" className="secondary-button" disabled={busy}
            onClick={() => settings && save({ ...settings, announcement: null })}>{t("luftAdmin.announcementRemove")}</button>}
          <button type="submit" className="primary-button" disabled={busy || !changed || !text.trim()}>{t("luftAdmin.announcementSend")}</button>
        </div>
      </form>
    </section>

    <section className="luft-tool">
      <header><DatabaseBackup size={18} aria-hidden="true" /><div><h3>{t("luftAdmin.backup")}</h3><p>{t("luftAdmin.backupHint")}</p></div></header>
      <div className="luft-tool-actions">
        <button type="button" className="secondary-button" disabled={disabled || backup.isPending} onClick={() => backup.mutate()}>
          <DatabaseBackup size={15} aria-hidden="true" />{t(backup.isPending ? "luftAdmin.backupRunning" : "luftAdmin.backupMake")}
        </button>
      </div>
      {backup.isSuccess && <p className="luft-tool-result" role="status">{t("luftAdmin.backupSaved", { path: backup.data })}</p>}
      {backup.isError && <p className="friends-inline-error" role="alert">{friendsErrorText(backup.error)}</p>}
    </section>

    <section className="luft-tool"><LuftCodeForm controls={controls} disabled={disabled} /></section>
    <section className="luft-tool luft-tool-wide"><FriendsBadgeEditor badges={snapshot.badges ?? []} controls={controls} disabled={disabled} /></section>
  </div>;
}
