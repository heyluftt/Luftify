import { describe, expect, it } from "vitest";
import { DeferredPlaybackIntentCoordinator } from "../src/features/playback/DeferredPlaybackIntent";

describe("deferred playback intent", () => {
  it("keeps only the latest startup choice", () => {
    let now = 1_000;
    const coordinator = new DeferredPlaybackIntentCoordinator(() => now, 30_000);
    coordinator.enqueueUri("spotify:playlist:first");
    now += 1;
    coordinator.enqueueUri("spotify:playlist:luft");
    expect(coordinator.take()).toMatchObject({ kind: "uri", uri: "spotify:playlist:luft" });
    expect(coordinator.take()).toBeUndefined();
  });

  it("never executes an expired startup choice", () => {
    let now = 1_000;
    const coordinator = new DeferredPlaybackIntentCoordinator(() => now, 500);
    coordinator.enqueueUri("spotify:playlist:old");
    now = 1_501;
    expect(coordinator.take()).toBeUndefined();
  });
});
