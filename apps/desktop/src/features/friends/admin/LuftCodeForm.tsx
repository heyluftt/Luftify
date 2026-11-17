import { useState } from "react";
import { t } from "../../../i18n";
import type { FriendsControls } from "../friendsTypes";

const CODE_INPUT = /[^A-Z0-9]/g;

/** Luft's own short friend code, e.g. LF-LUFT. */
export function LuftCodeForm({ controls, disabled }: { controls: FriendsControls; disabled: boolean }) {
  const [code, setCode] = useState("");
  return <form className="friends-owner-code" onSubmit={(event) => {
    event.preventDefault();
    if (code.length >= 3 && !controls.pending) controls.send({ type: "action", action: { type: "setFriendCode", code } }, () => setCode(""));
  }}>
    <label htmlFor="friends-owner-code">{t("roles.codeLabel")}</label>
    <div className="friends-inline-controls">
      <span className="friends-owner-code-field"><span aria-hidden="true">LF-</span>
        <input id="friends-owner-code" className="friends-mono" value={code} maxLength={10} autoComplete="off" spellCheck={false}
          placeholder="LUFT" disabled={disabled || controls.pending}
          onChange={(event) => setCode(event.currentTarget.value.toUpperCase().replace(CODE_INPUT, ""))} /></span>
      <button type="submit" className="secondary-button" disabled={disabled || controls.pending || code.length < 3}>{t("roles.codeSave")}</button>
    </div>
    <small>{t("roles.codeHint")}</small>
  </form>;
}
