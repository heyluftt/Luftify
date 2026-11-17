import { t } from "../../../i18n";
import type { Activity, FriendEntry } from "../friendsTypes";
import { playedAgo } from "./friendsTime";

export const isActive = (friend: FriendEntry, offline: boolean) =>
  !offline && (friend.presence.online || Boolean(friend.presence.track));

/** The dot colour: listening and online are green, away amber, busy red. */
export function activityOf({ presence }: FriendEntry, offline: boolean): Activity {
  if (offline) return "offline";
  if (presence.activity && presence.activity !== "offline") return presence.activity;
  // Older servers send only `online`; a shared track also means a live session.
  return presence.online || presence.track ? "online" : "offline";
}

/** The status under the name when the "listening now" card already shows the song. */
export function presenceStatus(friend: FriendEntry, offline: boolean): string {
  return friend.presence.track && !offline ? friendStatus({ ...friend, presence: { ...friend.presence, track: null } }, offline) : friendStatus(friend, offline);
}

export function friendStatus(friend: FriendEntry, offline: boolean): string {
  const { presence } = friend;
  if (offline) return t("friends.statusUnavailable");
  if (presence.track) return t(presence.isPlaying ? "friends.listening" : "friends.paused");
  switch (activityOf(friend, offline)) {
    case "busy": return t("activity.busy");
    case "away": return t("activity.away");
    case "online": return t("friends.online");
    default: return presence.lastSeenMs ? t("activity.lastSeen", { ago: playedAgo(presence.lastSeenMs) }) : t("friends.offlineOrHidden");
  }
}
