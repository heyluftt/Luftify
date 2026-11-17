import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@luft/protocol-types";

const edits: unknown[] = [];
vi.mock("../src/services/desktopApi", () => ({
  desktopApi: { listenTogetherQueueEdit: vi.fn(async (_room: string, edit: unknown) => { edits.push(edit); }) },
}));

const { addTracksToRoom, batchTracks, sharedTrack } = await import("../src/features/listen-together/roomQueueBatch");

const item = (n: number, playable = true): MediaItem => ({
  uri: `spotify:track:${String(n).padStart(22, "0")}`, source: "spotify", itemType: "track", title: `Song ${n}`,
  creators: [{ name: "Artist" }], explicit: false, playable,
} as MediaItem);
const status = (waiting: number) => ({ roomId: "room", queue: { revision: 1, items: Array.from({ length: waiting }) } }) as never;

describe("room queue batches", () => {
  beforeEach(() => { edits.length = 0; });

  it("splits by count and size", () => {
    const tracks = Array.from({ length: 120 }, (_, n) => sharedTrack(item(n))!);
    expect(batchTracks(tracks).map((batch) => batch.length)).toEqual([50, 50, 20]);
    const long = tracks.slice(0, 10).map((track) => ({ ...track, title: "x".repeat(10_000) }));
    expect(batchTracks(long).length).toBeGreaterThan(1);
  });

  it("keeps the order for play next, skips unplayable songs and stops at the limit", async () => {
    const items = [...Array.from({ length: 60 }, (_, n) => item(n)), item(99, false)];
    const result = await addTracksToRoom(status(150), items, true);
    expect(result).toEqual({ added: 50, skipped: 11 });
    expect(edits).toHaveLength(1);
    edits.length = 0;
    await addTracksToRoom(status(0), items, true);
    // Two batches; the later one goes first so the first song ends up in front.
    const first = edits[0] as { tracks: { uri: string }[]; next: boolean };
    expect(edits).toHaveLength(2);
    expect(first.next).toBe(true);
    expect(first.tracks[0]!.uri).toBe(item(50).uri);
    await expect(addTracksToRoom(status(200), items, false)).rejects.toThrow("listen.queueFull");
  });
});
