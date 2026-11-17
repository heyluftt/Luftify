import { t } from "../../i18n";
import type { SocialProfile, SocialSnapshot } from "../friends/friendsTypes";
import type { ListenTogetherStatus } from "../listen-together/listenTogetherTypes";
import type { ProblemReportSummary } from "../problem-report/problemReportApi";
import type { AppNotice, NoticePerson } from "./noticeStore";
import { achievementName, isAchievement } from "../friends/achievements/achievements";

export interface NoticeChanges { push: AppNotice[]; dismiss: string[] }

const none = (): NoticeChanges => ({ push: [], dismiss: [] });
const person = (profile: SocialProfile): NoticePerson => ({ name: profile.displayName, avatarUri: profile.avatarUri, roles: profile.roles });

/** What changed between two friends snapshots that is worth a notice. */
export function friendChanges(before: SocialSnapshot, after: SocialSnapshot, now = Date.now()): NoticeChanges {
  const changes = none();
  const known = new Set(before.incomingRequests.map((request) => request.id));
  for (const request of after.incomingRequests) {
    if (!known.has(request.id)) changes.push.push({
      id: `request-${request.id}`, kind: "friend", person: person(request.profile),
      title: t("notice.request", { name: request.profile.displayName }),
      action: { label: t("notice.view"), to: "/friends" },
    });
  }
  const still = new Set(after.incomingRequests.map((request) => request.id));
  changes.dismiss.push(...[...known].filter((id) => !still.has(id)).map((id) => `request-${id}`));

  const waiting = new Set(before.outgoingRequests.map((request) => request.profile.id));
  const friends = new Set(before.friends.map((friend) => friend.profile.id));
  for (const friend of after.friends) {
    if (waiting.has(friend.profile.id) && !friends.has(friend.profile.id)) changes.push.push({
      id: `accepted-${friend.profile.id}`, kind: "friend", person: person(friend.profile),
      title: t("notice.accepted", { name: friend.profile.displayName }),
    });
  }

  const invited = new Set(before.invitations.map((invitation) => invitation.id));
  for (const invitation of after.invitations) {
    const song = after.friends.find((friend) => friend.profile.id === invitation.from.id)?.presence?.track?.title;
    if (!invited.has(invitation.id) && invitation.expiresAtMs > now) changes.push.push({
      id: `invite-${invitation.id}`, kind: "invite", person: person(invitation.from),
      title: song ? t("friends.invitationNoticeSong", { name: invitation.from.displayName, title: song })
        : t("friends.invitationNotice", { name: invitation.from.displayName }),
      action: { label: t("friends.viewInvitation"), to: "/friends#invitations" },
      untilMs: invitation.expiresAtMs,
    });
  }
  const open = new Set(after.invitations.map((invitation) => invitation.id));
  changes.dismiss.push(...[...invited].filter((id) => !open.has(id)).map((id) => `invite-${id}`));

  const shared = new Set((before.playlistShares ?? []).map((share) => share.id));
  for (const share of after.playlistShares ?? []) {
    if (!shared.has(share.id)) changes.push.push({
      id: `playlist-${share.id}`, kind: "playlist", person: person(share.from),
      title: t("playlists.sharedNotice", { name: share.from.displayName, playlist: share.playlist.name }),
      action: { label: t("playlists.view"), to: "/friends#playlist-shares" },
    });
  }
  const sharing = new Set((after.playlistShares ?? []).map((share) => share.id));
  changes.dismiss.push(...[...shared].filter((id) => !sharing.has(id)).map((id) => `playlist-${id}`));

  const listening = new Set(before.listeners ?? []);
  for (const id of after.listeners ?? []) {
    const profile = after.friends.find((friend) => friend.profile.id === id)?.profile;
    if (!listening.has(id) && profile) changes.push.push({
      id: `along-${id}`, kind: "along", person: person(profile), title: t("listenAlong.notice", { name: profile.displayName }),
    });
  }
  return changes;
}

/** Achievements reached since the last snapshot; shown on every page. */
export function achievementChanges(before: SocialSnapshot, after: SocialSnapshot): NoticeChanges {
  const changes = none();
  const known = new Set(before.me.achievements ?? []);
  for (const id of after.me.achievements ?? []) {
    if (!known.has(id) && isAchievement(id)) changes.push.push({
      id: `achievement-${id}`, kind: "achievement",
      title: t("achievements.unlocked", { name: t(achievementName(id)) }),
      action: { label: t("notice.view"), to: "/friends#achievements" },
    });
  }
  return changes;
}

/**
 * Who came and went in your room, and who leads it. Names rather than ids:
 * a member who reconnects comes back under a new id.
 */
export function roomChanges(before: ListenTogetherStatus, after: ListenTogetherStatus): NoticeChanges {
  const changes = none();
  if (!before.roomId || before.roomId !== after.roomId || after.connection !== "online") return changes;
  if (before.role !== "host" && after.role === "host") {
    changes.push.push({ id: `host-${after.roomId}`, kind: "host", title: t("notice.youHost") });
  } else if (after.role === "guest" && after.hostName && before.hostName && after.hostName !== before.hostName) {
    changes.push.push({ id: `host-${after.roomId}`, kind: "host", title: t("notice.newHost", { name: after.hostName }) });
  }
  const others = (status: ListenTogetherStatus) => status.participants.filter((p) => p.id !== status.youId);
  const was = others(before);
  const now = others(after);
  const face = (list: typeof now, name: string) => {
    const member = list.find((p) => p.displayName === name);
    return { name, avatarUri: member?.avatarUri, roles: member?.roles };
  };
  for (const name of difference(now.map((p) => p.displayName), was.map((p) => p.displayName))) {
    changes.push.push({ id: `joined-${after.roomId}-${name}`, kind: "room", person: face(now, name), title: t("notice.joined", { name }) });
  }
  for (const name of difference(was.map((p) => p.displayName), now.map((p) => p.displayName))) {
    changes.push.push({ id: `left-${after.roomId}-${name}`, kind: "room", person: face(was, name), title: t("notice.left", { name }) });
  }
  return changes;
}

/** New problem reports for Luft. */
export function reportChanges(before: ProblemReportSummary[], after: ProblemReportSummary[]): NoticeChanges {
  const changes = none();
  const known = new Set(before.map((report) => report.id));
  for (const report of after) {
    if (!known.has(report.id)) changes.push.push({
      id: `report-${report.id}`, kind: "report",
      title: t("notice.report", { name: report.reporterName }),
      action: { label: t("notice.view"), to: "/friends#luft" },
    });
  }
  return changes;
}

/** Names in `a` more often than in `b`. */
function difference(a: string[], b: string[]): string[] {
  const left = [...b];
  return a.filter((name) => {
    const index = left.indexOf(name);
    if (index < 0) return true;
    left.splice(index, 1);
    return false;
  });
}
