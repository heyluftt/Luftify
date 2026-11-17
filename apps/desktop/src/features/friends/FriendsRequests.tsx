import { Check, Headphones, ShieldBan, UserRoundPlus, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../i18n";
import { ProfileAvatar } from "../listen-together/ProfileAvatar";
import type { FriendRequest, FriendsControls, SocialSnapshot } from "./friendsTypes";

export function FriendsRequests({ snapshot, controls, disabled }: { snapshot: SocialSnapshot; controls: FriendsControls; disabled: boolean }) {
  const busy = disabled || controls.pending;
  if (!snapshot.incomingRequests.length && !snapshot.outgoingRequests.length) return null;
  return <section className="friends-panel friends-requests" aria-labelledby="friends-requests-title">
    <div className="friends-section-heading"><h2 id="friends-requests-title">{t("friends.requestsTitle")}<span className="friends-count">{snapshot.incomingRequests.length}</span></h2><UserRoundPlus size={21} aria-hidden="true" /></div>
    {!!snapshot.incomingRequests.length && <ul className="friends-people">{snapshot.incomingRequests.map(request => <IncomingRequest key={request.id} request={request} controls={controls} disabled={busy} />)}</ul>}
    {!!snapshot.outgoingRequests.length && <details className="friends-outgoing"><summary>{t("friends.outgoingCount", { n: snapshot.outgoingRequests.length })}</summary>
      {snapshot.outgoingRequests.map(request => <div className="friends-person" key={request.id}><ProfileAvatar name={request.profile.displayName} uri={request.profile.avatarUri} />
        <div className="friends-person-copy"><strong>{request.profile.displayName}</strong><small className="friends-mono">{request.profile.friendCode}</small></div>
        <button type="button" className="text-button" disabled={busy}
          onClick={() => controls.send({ type: "action", action: { type: "cancelRequest", requestId: request.id } })}>{t("friends.withdraw")}</button></div>)}
    </details>}
  </section>;
}

function IncomingRequest({ request, controls, disabled }: { request: FriendRequest; controls: FriendsControls; disabled: boolean }) {
  const [block, setBlock] = useState(false);
  return <li><div className="friends-person">
    <ProfileAvatar name={request.profile.displayName} uri={request.profile.avatarUri} />
    <div className="friends-person-copy"><strong>{request.profile.displayName}</strong><small className="friends-mono">{request.profile.friendCode}</small></div>
    <div className="friends-row-actions"><button type="button" className="primary-button" disabled={disabled}
      onClick={() => controls.send({ type: "action", action: { type: "respondRequest", requestId: request.id, accept: true } })}><Check size={15} aria-hidden="true" />{t("friends.accept")}</button>
      <button type="button" className="friends-icon-button" title={t("friends.reject")} aria-label={t("friends.rejectRequest", { name: request.profile.displayName })} disabled={disabled}
        onClick={() => controls.send({ type: "action", action: { type: "respondRequest", requestId: request.id, accept: false } })}><X size={18} aria-hidden="true" /></button>
      <button type="button" className="friends-icon-button" title={t("friends.block")} aria-label={`${t("friends.block")}: ${request.profile.displayName}`} disabled={disabled}
        onClick={() => setBlock(true)}><ShieldBan size={17} aria-hidden="true" /></button>
    </div>
  </div>{block && <div className="friends-confirm" role="group" aria-label={t("friends.confirmAction")}><p>{t("friends.blockConfirm", { name: request.profile.displayName })}</p>
    <div><button type="button" className="secondary-button" disabled={disabled} onClick={() => setBlock(false)}>{t("friends.cancel")}</button>
      <button type="button" className="secondary-button danger" disabled={disabled}
        onClick={() => controls.send({ type: "action", action: { type: "block", profileId: request.profile.id } })}>{t("friends.block")}</button></div></div>}</li>;
}

export function FriendsInvitations({ snapshot, controls, disabled }: { snapshot: SocialSnapshot; controls: FriendsControls; disabled: boolean }) {
  const navigate = useNavigate();
  const invitations = snapshot.invitations.filter(invitation => invitation.expiresAtMs > Date.now());
  if (!invitations.length) return null;
  return <section id="invitations" className="friends-panel friends-invitations" aria-labelledby="friends-invitations-title">
    <div className="friends-section-heading"><div><span className="eyebrow">{t("friends.invitationEyebrow")}</span><h2 id="friends-invitations-title">{t("friends.invitationsTitle")}</h2></div><Headphones size={24} aria-hidden="true" /></div>
    <ul className="friends-people">{invitations.map(invitation => <li className="friends-person" key={invitation.id}>
      <ProfileAvatar name={invitation.from.displayName} uri={invitation.from.avatarUri} />
      <div className="friends-person-copy"><strong>{invitation.from.displayName}</strong>
        <small>{invitingSong(snapshot, invitation.from.id) ? t("listenAlong.inviteSong", { title: invitingSong(snapshot, invitation.from.id)! })
          : t("friends.invitationExpiry", { n: Math.max(1, Math.ceil((invitation.expiresAtMs - Date.now()) / 60_000)) })}</small></div>
      <div className="friends-row-actions"><button type="button" className="primary-button" disabled={disabled || controls.pending}
        onClick={() => controls.send({ type: "acceptInvite", invitationId: invitation.id }, () => navigate("/listen"))}>{t("friends.joinInvite")}</button>
        <button type="button" className="friends-icon-button" disabled={disabled || controls.pending} title={t("friends.dismissInvite")} aria-label={t("friends.dismissInviteFrom", { name: invitation.from.displayName })}
          onClick={() => controls.send({ type: "dismissInvite", invitationId: invitation.id })}><X size={18} aria-hidden="true" /></button></div>
    </li>)}</ul>
    <p className="friends-muted">{t("friends.invitationPlaybackHint")}</p>
  </section>;
}

/** What the inviting friend plays, when they share it: that is what the room starts with. */
function invitingSong(snapshot: SocialSnapshot, profileId: string): string | undefined {
  return snapshot.friends.find((friend) => friend.profile.id === profileId)?.presence.track?.title ?? undefined;
}
