import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/features/discovery/mixPersistence", () => ({ persistMixes: vi.fn().mockResolvedValue(undefined), loadMixes: vi.fn() }));
import { recentMixTrackUris, replacementCandidate, retainMixes, useMixLibrary, type SavedMix } from "../src/features/discovery/mixLibrary";

const mix = (id: number, pinned = false): SavedMix => ({
  id: String(id), createdAt: id, name: "", pinned,
  picks: [{ novel: true, sources: 1, track: {
    uri: `spotify:track:${id}`, title: `Track ${id}`, creators: [{ name: "Artist" }],
    source: "spotify", itemType: "track", playable: true, explicit: false,
  } }],
});

describe("local mix collection", () => {
  beforeEach(() => {
    localStorage.clear();
    useMixLibrary.setState({ mixes: [], storageError: false, ready: true });
  });
  it("replaces the oldest unpinned mix, protecting pinned favorites", () => {
    expect(retainMixes([mix(6), mix(5), mix(4), mix(3), mix(2), mix(1, true)])
      .map((entry) => entry.id)).toEqual(["6", "5", "4", "3", "1"]);
  });
  it("collects track uris from the newest mixes for consecutive-repeat avoidance", () => {
    expect([...recentMixTrackUris([mix(4), mix(3), mix(2), mix(1)], mix(9).picks)])
      .toEqual(["spotify:track:9", "spotify:track:4", "spotify:track:3", "spotify:track:2"]);
  });
  it("leaves one slot for fresh mixes when four are pinned", () => {
    expect(retainMixes([mix(6), mix(5), mix(4, true), mix(3, true), mix(2, true), mix(1, true)])
      .map((entry) => entry.id)).toEqual(["6", "4", "3", "2", "1"]);
  });
  it("names the mix a new one would replace and restores a removed mix", () => {
    expect(replacementCandidate([mix(4), mix(3), mix(2)])).toBeUndefined();
    expect(replacementCandidate([mix(5), mix(4, true), mix(3), mix(2, true), mix(1, true)])?.id).toBe("3");
    useMixLibrary.setState({ mixes: [mix(3), mix(2, true), mix(1)] });
    const removed = useMixLibrary.getState().remove("2")!;
    expect(useMixLibrary.getState().restore(removed)).toBe(true);
    expect(useMixLibrary.getState().mixes.map((entry) => [entry.id, entry.pinned])).toEqual([["3", false], ["2", true], ["1", false]]);
  });
  it("persists edits, ignores empty/duplicate results and removes only the selected mix", () => {
    const store = useMixLibrary.getState();
    store.add([]);
    store.add(mix(1).picks);
    store.add(mix(1).picks);
    expect(useMixLibrary.getState().mixes).toHaveLength(1);
    const id = useMixLibrary.getState().mixes[0]!.id;
    store.rename(id, " Evening ");
    store.rename(id, "");
    store.rename(id, "   ");
    expect(useMixLibrary.getState().mixes[0]!.name).toBe("Evening");
    store.togglePin(id);
    expect(JSON.parse(localStorage.getItem("luft.discovery.library.v1")!)[0])
      .toMatchObject({ id, name: "Evening", pinned: true });
    store.add(mix(2).picks);
    store.remove(id);
    expect(useMixLibrary.getState().mixes).toHaveLength(1);
    expect(useMixLibrary.getState().mixes[0]!.picks[0]!.track.uri).toBe("spotify:track:2");
  });
});
