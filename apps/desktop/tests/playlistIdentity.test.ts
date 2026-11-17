import { describe, expect, it } from "vitest";
import { resolvePlaylistProfile } from "../src/features/playlists/playlistIdentity";
import { mergePlaylistDates } from "../src/features/entities/playlistSnapshot";
import type { SocialSnapshot } from "../src/features/friends/friendsTypes";
import type { MediaItem } from "@luft/protocol-types";

const alice = { id: "alice", displayName: "Luftify Alice", avatarUri: null, friendCode: "LF-ALICE" };
const bob = { ...alice, id: "bob", displayName: "Luftify Bob" };
const snapshot: SocialSnapshot = {
  me: alice, options: { discoverable: true, shareOnline: true, shareListening: true, allowInvites: true },
  friends: [{ profile: bob, presence: { online: true, track: null, isPlaying: false } }],
  incomingRequests: [], outgoingRequests: [], invitations: [], blocked: [],
  playlistAccounts: [{ profileId: bob.id, accountKey: "bob-key" }],
};

describe("Luftify playlist identities", () => {
  it("uses Luftify names, follows renames and rejects ambiguous or stale cached identities", () => {
    const person = { username: "spotify-bob", displayName: "Spotify Bob", isSelf: true };
    expect(resolvePlaylistProfile(person, "bob-key", snapshot)?.displayName).toBe("Luftify Bob");
    expect(resolvePlaylistProfile(person, undefined, snapshot)).toBeUndefined();
    expect(resolvePlaylistProfile(person, "bob-key", { ...snapshot, friends: [{ ...snapshot.friends[0]!, profile: { ...bob, displayName: "New Luftify name" } }] })?.displayName).toBe("New Luftify name");
    expect(resolvePlaylistProfile(person, "bob-key", { ...snapshot, playlistAccounts: [...snapshot.playlistAccounts!, { profileId: alice.id, accountKey: "bob-key" }] })).toBeUndefined();
    expect(resolvePlaylistProfile(person, "bob-key", { ...snapshot, friends: [] })).toBeUndefined();
  });

  it("keeps duplicate songs attached to their entry author and never borrows removed entries", () => {
    const track: MediaItem = { uri: "spotify:track:one", source: "spotify", itemType: "track", title: "Song", creators: [], explicit: false, playable: true };
    const cache = [
      { ...track, playlistEntryId: "one", addedBy: { username: "a", isSelf: false } },
      { ...track, playlistEntryId: "two", addedBy: { username: "b", isSelf: false } },
    ];
    const incoming = [{ ...track, playlistEntryId: "two" }, { ...track, playlistEntryId: "new" }, { ...track, playlistEntryId: "one" }];
    expect(mergePlaylistDates(incoming, cache).map(t => t.addedBy?.username)).toEqual(["b", undefined, "a"]);
  });
});
