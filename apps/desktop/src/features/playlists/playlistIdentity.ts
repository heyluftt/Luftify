import type { PlaylistContributor } from "@luft/protocol-types";
import type { SocialProfile, SocialSnapshot } from "../friends/friendsTypes";

/** The same comparison used for the local account and Spotify's entry authors. */
export async function playlistAccountKey(username: string): Promise<string> {
  const bytes = new TextEncoder().encode(`luftify:playlist-account:v1:${username.trim()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function resolvePlaylistProfile(person: PlaylistContributor, key: string | undefined, snapshot: SocialSnapshot | undefined): SocialProfile | undefined {
  if (!snapshot) return undefined;
  // isSelf can come from an old cache/account. Only the current server binding is authoritative.
  if (!key) return undefined;
  const ids = new Set(snapshot.playlistAccounts?.filter(account => account.accountKey === key).map(account => account.profileId));
  if (ids.size !== 1) return undefined; // Shared accounts or conflicting claims must never be guessed.
  const [id] = ids;
  return [snapshot.me, ...snapshot.friends.map(friend => friend.profile)].find(profile => profile.id === id);
}
