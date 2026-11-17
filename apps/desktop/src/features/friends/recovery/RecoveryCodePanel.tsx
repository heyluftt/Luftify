import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import { friendsApi } from "../friendsApi";
import { friendsErrorText, useFriends, useFriendsControls } from "../useFriends";
import { RestoreForm } from "./RestoreForm";
import "../../../styles/components/recovery.css";

/** Settings: show, copy or renew the recovery code; restore another profile. */
export function RecoveryCodePanel() {
  const friends = useFriends();
  const { controls, mutation } = useFriendsControls();
  const [code, setCode] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [copied, setCopied] = useState(false);
  const me = friends.data?.snapshot?.me;
  const online = friends.data?.connection === "online";
  // A secret on screen only as long as needed: gone with the profile or the page.
  useEffect(() => { setCode(null); setConfirm(false); }, [me?.id]);
  useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(false), 1600); return () => window.clearTimeout(timer); }, [copied]);
  const load = useMutation({
    mutationFn: friendsApi.recoveryCode,
    onSuccess: (value) => { setCode(value); setConfirm(false); },
  });
  const error = load.isError ? friendsErrorText(load.error) : mutation.isError ? friendsErrorText(mutation.error) : undefined;

  return <div className="recovery-panel">
    <h3>{t("recovery.title")}</h3>
    <p className="settings-inline-hint">{t("recovery.hint")}</p>
    {!me ? <p className="recovery-muted">{t("recovery.inactive")}</p> : <>
      {code && <output className="recovery-code" aria-label={t("recovery.code")}>{code}</output>}
      <div className="recovery-actions">
        {code
          ? <button type="button" className="secondary-button" onClick={() => setCode(null)}><EyeOff size={15} aria-hidden="true" />{t("recovery.hide")}</button>
          : <button type="button" className="secondary-button" disabled={!online || load.isPending} onClick={() => load.mutate(false)}><Eye size={15} aria-hidden="true" />{t("recovery.show")}</button>}
        {code && <button type="button" className="secondary-button" onClick={() => { void navigator.clipboard.writeText(code).then(() => setCopied(true)); }}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{t(copied ? "recovery.copied" : "recovery.copy")}
        </button>}
        <button type="button" className="secondary-button" disabled={!online || load.isPending} onClick={() => setConfirm(true)}><RefreshCw size={15} aria-hidden="true" />{t("recovery.renew")}</button>
      </div>
      {confirm && <div className="recovery-confirm" role="group" aria-label={t("recovery.renew")}>
        <p>{t("recovery.renewConfirm")}</p>
        <div><button type="button" className="secondary-button" disabled={load.isPending} onClick={() => setConfirm(false)}>{t("recovery.cancel")}</button>
          <button type="button" className="secondary-button danger" disabled={load.isPending} onClick={() => load.mutate(true)}>{t("recovery.confirm")}</button></div>
      </div>}
    </>}
    {restoring
      ? <RestoreForm pending={controls.pending} warning={Boolean(me)} onCancel={() => { setRestoring(false); mutation.reset(); }}
        onRestore={(value) => controls.send({ type: "restore", code: value }, () => { setRestoring(false); setCode(null); })} />
      : <button type="button" className="text-button recovery-switch" disabled={!friends.data} onClick={() => { setRestoring(true); load.reset(); }}>
        {t(me ? "recovery.restoreOther" : "recovery.restore")}
      </button>}
    {mutation.isSuccess && mutation.variables?.type === "restore" && <p role="status">{t("recovery.restored")}</p>}
    {error && <p className="recovery-error" role="alert">{error}</p>}
  </div>;
}
