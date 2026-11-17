import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { desktopApi } from "../src/services/desktopApi";
import { setListenTogetherStatus, useListenRoomState } from "../src/features/listen-together/guestLock";
import { skipRoomTrack } from "../src/features/listen-together/roomTransport";
import { playbackCommands } from "../src/features/playback/playbackCommands";
import { resetPlayerStore, usePlayerStore } from "../src/stores/playerStore";
import type { ListenTogetherStatus } from "../src/features/listen-together/listenTogetherTypes";
import type { PlaybackState } from "@luft/protocol-types";

const room: ListenTogetherStatus = {
  roomId: "room", connection: "online", role: "guest", hostConnected: true, serverUrl: "",
  participants: [], control: "everyone", canControl: true, youId: "guest", revision: 2, driftMs: 0, reconnectAttempts: 0,
  queue: { revision: 3, current: { id: "occurrence-1", track: { provider: "spotify", uri: "spotify:track:same" } },
    items: [{ id: "occurrence-2", track: { provider: "spotify", uri: "spotify:track:same" } }] },
};
beforeEach(() => {
  resetPlayerStore();
  useListenRoomState.setState({ status: undefined, locked: false, skipping: false, error: false });
});
afterEach(() => { vi.restoreAllMocks(); resetPlayerStore(); useListenRoomState.setState({ status: undefined, locked: false, skipping: false, error: false }); });

it("accepts guest playback without a local play click", () => {
  setListenTogetherStatus(room);
  const playback: PlaybackState = {
    currentItem: { uri: "spotify:track:shared", source: "spotify", itemType: "track", title: "Shared song",
      creators: [{ name: "Artist" }], durationMs: 180000, explicit: false, playable: true },
    isPlaying: true, positionMs: 12000, durationMs: 180000, volume: 0.5, isMuted: false,
    shuffleEnabled: false, repeatMode: "one", isSaved: false, updatedAt: new Date().toISOString(),
  };
  usePlayerStore.getState().setPlayback(playback);
  expect(usePlayerStore.getState().playback?.currentItem?.title).toBe("Shared song");
  expect(usePlayerStore.getState().playback?.positionMs).toBe(12000);
});

it("routes Next through the room and ignores rapid clicks until acknowledgement", async () => {
  let finish!: () => void;
  const send = vi.spyOn(desktopApi, "listenTogetherQueueEdit").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  setListenTogetherStatus(room);
  playbackCommands.send({ command: "next" });
  setListenTogetherStatus({ ...room, queue: { ...room.queue!, current: room.queue!.items[0]! } });
  playbackCommands.send({ command: "next" });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith("room", { type: "remove", id: "occurrence-1" });
  finish();
  await vi.waitFor(() => expect(useListenRoomState.getState().skipping).toBe(false));
});

it("does not skip offline and exposes uncertain failures without replaying them", async () => {
  const send = vi.spyOn(desktopApi, "listenTogetherQueueEdit").mockRejectedValue(new Error("lost ack"));
  setListenTogetherStatus({ ...room, connection: "reconnecting" });
  await skipRoomTrack();
  expect(send).not.toHaveBeenCalled();
  setListenTogetherStatus(room);
  await skipRoomTrack();
  expect(send).toHaveBeenCalledTimes(1);
  expect(useListenRoomState.getState().error).toBe(true);
  expect(useListenRoomState.getState().skipping).toBe(false);
});

it("lets a guest without control skip only their own song and never steer", async () => {
  const skip = vi.spyOn(desktopApi, "listenTogetherQueueEdit").mockResolvedValue();
  const control = vi.spyOn(desktopApi, "listenTogetherControl").mockResolvedValue();
  const locked: ListenTogetherStatus = { ...room, control: "hostOnly", canControl: false };
  setListenTogetherStatus(locked);
  playbackCommands.send({ command: "pause" });
  await skipRoomTrack();
  expect(control).not.toHaveBeenCalled();
  expect(skip).not.toHaveBeenCalled();

  setListenTogetherStatus({ ...locked, queue: { ...locked.queue!, current: { ...locked.queue!.current!, addedById: "guest" } } });
  await skipRoomTrack();
  expect(skip).toHaveBeenCalledWith("room", { type: "remove", id: "occurrence-1" });
});

it("sends play and pause to the room once the guest may steer", async () => {
  const control = vi.spyOn(desktopApi, "listenTogetherControl").mockResolvedValue();
  setListenTogetherStatus(room);
  playbackCommands.send({ command: "pause" });
  playbackCommands.send({ command: "previous" });
  await vi.waitFor(() => expect(control).toHaveBeenCalledTimes(2));
  expect(control).toHaveBeenNthCalledWith(1, { type: "pause" });
  expect(control).toHaveBeenNthCalledWith(2, { type: "seek", positionMs: 0 });
});
