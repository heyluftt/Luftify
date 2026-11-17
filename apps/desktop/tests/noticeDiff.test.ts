import { describe, expect, it } from "vitest";
import type { SocialProfile, SocialSnapshot } from "../src/features/friends/friendsTypes";
import type { ListenTogetherStatus } from "../src/features/listen-together/listenTogetherTypes";
import { achievementChanges, friendChanges, roomChanges } from "../src/features/notices/noticeDiff";

const person = (id: string, displayName = id) => ({ id, displayName, friendCode: `LF-${id}`, avatarUri: null }) as unknown as SocialProfile;
const snapshot = (patch: Partial<SocialSnapshot> = {}) => ({
  me: person("me"), options: {}, friends: [], incomingRequests: [], outgoingRequests: [], invitations: [], blocked: [], ...patch,
}) as unknown as SocialSnapshot;
const room = (patch: Partial<ListenTogetherStatus>) => ({
  connection: "online", serverUrl: "", role: "guest", roomId: "r1", hostName: "Host", hostConnected: true,
  participants: [], control: "hostOnly", revision: 1, driftMs: 0, reconnectAttempts: 0, youId: "me", ...patch,
}) as ListenTogetherStatus;
const member = (id: string, displayName: string) => ({ id, displayName, isHost: false, connected: true });

describe("friend notices", () => {
  it("announces new requests, accepted requests and invitations, and clears answered ones", () => {
    const before = snapshot({
      incomingRequests: [{ id: "old", profile: person("a", "Anna"), createdAtMs: 0 }],
      outgoingRequests: [{ id: "out", profile: person("b", "Ben"), createdAtMs: 0 }],
    });
    const after = snapshot({
      incomingRequests: [{ id: "new", profile: person("c", "Cleo"), createdAtMs: 0 }],
      friends: [{ profile: person("b", "Ben") } as never],
      invitations: [{ id: "inv", from: person("b", "Ben"), joinCode: "ABC", expiresAtMs: 2_000 }],
    });
    const changes = friendChanges(before, after, 1_000);
    expect(changes.push.map((notice) => notice.id)).toEqual(["request-new", "accepted-b", "invite-inv"]);
    expect(changes.push[2]?.untilMs).toBe(2_000);
    expect(changes.dismiss).toEqual(["request-old"]);
    // Expired invitations never pop up.
    expect(friendChanges(before, after, 3_000).push.map((notice) => notice.id)).not.toContain("invite-inv");
  });
});

describe("listening along notices", () => {
  it("announces who starts listening along and names the song an invitation starts with", () => {
    const mika = { profile: person("m", "Mika"), presence: { online: true, isPlaying: true, track: { provider: "spotify", uri: "spotify:track:x", title: "Nachtbus" } } } as never;
    const before = snapshot({ friends: [mika] });
    const after = snapshot({
      friends: [mika], listeners: ["m"],
      invitations: [{ id: "inv", from: person("m", "Mika"), joinCode: "ABC", expiresAtMs: 2_000 }],
    });
    const changes = friendChanges(before, after, 1_000);
    expect(changes.push.map((notice) => notice.id)).toEqual(["invite-inv", "along-m"]);
    expect(changes.push[0]?.title).toContain("Nachtbus");
    // Still listening along: no second notice.
    expect(friendChanges(after, after, 1_000).push).toEqual([]);
  });
});

describe("achievement notices", () => {
  it("announces newly reached achievements only", () => {
    const before = snapshot({ me: { ...person("me"), achievements: ["first_friend"] } as SocialProfile });
    const after = snapshot({ me: { ...person("me"), achievements: ["first_friend", "song", "unknown"] } as SocialProfile });
    expect(achievementChanges(before, after).push.map((notice) => notice.id)).toEqual(["achievement-song"]);
    expect(achievementChanges(after, after).push).toEqual([]);
  });
});

describe("room notices", () => {
  it("names who joined and left, but not a member who reconnects under a new id", () => {
    const before = room({ participants: [member("me", "Me"), member("x1", "Anna"), member("y", "Ben")] });
    const after = room({ participants: [member("me", "Me"), member("x2", "Anna"), member("z", "Cleo")] });
    expect(roomChanges(before, after).push.map((notice) => notice.id)).toEqual(["joined-r1-Cleo", "left-r1-Ben"]);
  });

  it("tells you when you lead the room now, or who does", () => {
    expect(roomChanges(room({}), room({ role: "host" })).push[0]?.kind).toBe("host");
    expect(roomChanges(room({}), room({ hostName: "Anna" })).push[0]?.id).toBe("host-r1");
  });

  it("stays quiet when you enter, leave or switch rooms, or while reconnecting", () => {
    const people = [member("me", "Me"), member("a", "Anna")];
    expect(roomChanges(room({ roomId: null }), room({ participants: people })).push).toEqual([]);
    expect(roomChanges(room({ participants: people }), room({ roomId: "r2" })).push).toEqual([]);
    expect(roomChanges(room({ participants: people }), room({ connection: "reconnecting" })).push).toEqual([]);
  });
});
