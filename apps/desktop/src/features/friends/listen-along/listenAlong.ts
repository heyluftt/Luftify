import { appLanguage, t, type MessageKey } from "../../../i18n";
import type { FriendEntry, FriendsStatus, SocialSnapshot } from "../friendsTypes";

/** The friend being listened along with, if any, with their name. */
export function listenAlongState(status: FriendsStatus | undefined) {
  const along = status?.listenAlong;
  if (!along) return null;
  const friend = status?.snapshot?.friends.find((entry) => entry.profile.id === along.profileId);
  return { ...along, name: friend?.profile.displayName ?? "" };
}

/** On a friend's card: they listen along with you, or you with them. */
export function alongRelation(status: FriendsStatus | undefined, profileId: string): "listener" | "following" | null {
  const along = status?.listenAlong;
  if (along?.profileId === profileId && along.phase !== "ended") return "following";
  return status?.snapshot?.listeners?.includes(profileId) ? "listener" : null;
}

/** Whether a friend plays something shared right now. */
export const canListenAlong = (friend: FriendEntry, offline: boolean) => !offline && Boolean(friend.presence.track && friend.presence.isPlaying);

/** "Mika hört bei dir mit" or "Mika und Jo hören bei dir mit". */
export function listenersText(snapshot: SocialSnapshot): string | null {
  const names = (snapshot.listeners ?? [])
    .map((id) => snapshot.friends.find((friend) => friend.profile.id === id)?.profile.displayName)
    .filter((name): name is string => Boolean(name));
  if (!names.length) return null;
  if (names.length === 1) return t("listenAlong.listener", { name: names[0]! });
  return t("listenAlong.listeners", { names: new Intl.ListFormat(appLanguage(), { type: "conjunction" }).format(names) });
}

export const endedText = (reason: string | null, name: string) =>
  t((reason?.startsWith("listenAlong.ended.") ? reason : "listenAlong.ended.friend") as MessageKey, { name });
