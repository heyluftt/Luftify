import { ShieldCheck } from "lucide-react";
import { t, type MessageKey } from "../../i18n";
import type { FriendsControls, SocialOptions, SocialSnapshot } from "./friendsTypes";

const options: { key: "discoverable" | "shareOnline" | "shareListening" | "allowInvites"; title: MessageKey; hint: MessageKey }[] = [
  { key: "discoverable", title: "friends.option.discoverable", hint: "friends.option.discoverableHint" },
  { key: "shareOnline", title: "friends.option.online", hint: "friends.option.onlineHint" },
  { key: "shareListening", title: "friends.option.listening", hint: "friends.option.listeningHint" },
  { key: "allowInvites", title: "friends.option.invites", hint: "friends.option.invitesHint" },
];

export function FriendsOptions({ snapshot, controls, disabled }: { snapshot: SocialSnapshot; controls: FriendsControls; disabled: boolean }) {
  return <section className="friends-panel friends-options" aria-labelledby="friends-options-title">
    <div className="friends-section-heading"><h2 id="friends-options-title">{t("friends.optionsTitle")}</h2><ShieldCheck size={21} aria-hidden="true" /></div>
    <p className="friends-muted">{t("friends.optionsHint")}</p>
    {options.map(option => <label className="friends-option" key={option.key}>
      <span><strong>{t(option.title)}</strong><small>{t(option.hint)}</small></span>
      <span className="switch"><input type="checkbox" checked={snapshot.options[option.key]} disabled={disabled || controls.pending}
        onChange={event => controls.send({ type: "action", action: { type: "updateOptions", options: { ...snapshot.options, [option.key]: event.currentTarget.checked } } })} /><span /></span>
    </label>)}
    {snapshot.blocked.length > 0 && <details className="friends-blocked"><summary>{t("friends.blockedCount", { n: snapshot.blocked.length })}</summary>
      {snapshot.blocked.map(profile => <div className="friends-blocked-row" key={profile.id}><span>{profile.displayName}<small>{profile.friendCode}</small></span>
        <button type="button" className="text-button" disabled={disabled || controls.pending}
          onClick={() => controls.send({ type: "action", action: { type: "unblock", profileId: profile.id } })}>{t("friends.unblock")}</button></div>)}
    </details>}
  </section>;
}
