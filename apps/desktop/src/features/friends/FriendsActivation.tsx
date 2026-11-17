import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, UserRoundPlus } from "lucide-react";
import { desktopApi } from "../../services/desktopApi";
import { t } from "../../i18n";
import type { FriendsControls, FriendsStatus } from "./friendsTypes";
import { RestoreForm } from "./recovery/RestoreForm";

/** Before the first visit: create the friends profile on this server. */
export function FriendsActivation({ status, controls }: { status: FriendsStatus; controls: FriendsControls }) {
  const settings = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings });
  const me = status.snapshot?.me;
  const saved = settings.data?.listenTogether;
  const [name, setName] = useState("");
  const [restoring, setRestoring] = useState(false);
  useEffect(() => { setName(me?.displayName ?? saved?.displayName ?? ""); }, [me?.displayName, saved?.displayName]);
  const avatar = me?.avatarUri ?? saved?.avatarUri ?? null;
  return <section className="friends-panel friends-activation">
    <span className="friends-activation-icon"><UserRoundPlus size={30} aria-hidden="true" /></span>
    <div className="friends-activation-copy"><span className="eyebrow">{t("friends.activationEyebrow")}</span>
      <h2>{t("friends.activationTitle")}</h2><p>{t("friends.activationHint")}</p>
      <p className="friends-privacy-note"><ShieldCheck size={17} aria-hidden="true" />{t("friends.activationPrivacy")}</p>
    </div>
    {restoring ? <RestoreForm pending={controls.pending} onCancel={() => setRestoring(false)}
      onRestore={(code) => controls.send({ type: "restore", code })} /> : <form onSubmit={event => {
      event.preventDefault();
      if (!controls.pending && name.trim()) controls.send({ type: "activate", profile: { displayName: name.trim(), avatarUri: avatar } });
    }}>
      <label htmlFor="friends-activate-name">{t("listen.profileName")}</label>
      <input id="friends-activate-name" value={name} maxLength={32} autoComplete="nickname" required
        disabled={controls.pending || settings.isPending} onChange={event => setName(event.currentTarget.value)} />
      <button type="submit" className="primary-button" disabled={!name.trim() || controls.pending || settings.isPending}>
        {t(controls.pending ? "friends.working" : "friends.activate")}
      </button>
      <button type="button" className="text-button friends-activation-restore" disabled={controls.pending} onClick={() => setRestoring(true)}>
        <KeyRound size={15} aria-hidden="true" />{t("recovery.haveProfile")}
      </button>
    </form>}
  </section>;
}
