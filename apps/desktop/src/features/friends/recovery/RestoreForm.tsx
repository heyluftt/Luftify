import { KeyRound, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { t } from "../../../i18n";
import { normalizeRecoveryCode } from "./recoveryCode";
import "../../../styles/components/recovery.css";

/** Enter a recovery code to bring an existing profile to this device. */
export function RestoreForm({ pending, warning, onRestore, onCancel }: {
  pending: boolean;
  /** Shown when this device already has a profile that would be replaced. */
  warning?: boolean;
  onRestore: (code: string) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const valid = normalizeRecoveryCode(code);
  return <form className="recovery-restore" onSubmit={(event) => { event.preventDefault(); if (valid && !pending) onRestore(valid); }}>
    <label htmlFor={id}>{t(warning ? "recovery.restoreOther" : "recovery.code")}</label>
    <small id={`${id}-hint`}>{t(warning ? "recovery.restoreReplace" : "recovery.restoreHint")}</small>
    <input id={id} className="recovery-input" value={code} maxLength={32} autoComplete="off" spellCheck={false} autoFocus
      placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" aria-describedby={`${id}-hint`} disabled={pending}
      onChange={(event) => setCode(event.currentTarget.value.toUpperCase())} />
    <div className="recovery-actions">
      {onCancel && <button type="button" className="secondary-button" disabled={pending} onClick={onCancel}>{t("recovery.cancel")}</button>}
      <button type="submit" className={warning ? "secondary-button danger" : "primary-button"} disabled={!valid || pending}>
        {pending ? <LoaderCircle className="is-spinning" size={16} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
        {t("recovery.restoreSubmit")}
      </button>
    </div>
  </form>;
}
