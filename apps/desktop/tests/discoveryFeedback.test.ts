import { describe, expect, it } from "vitest";
import { interpretFeedback } from "../src/features/discovery/discoveryFeedback";

const DAY = 86_400_000;
const now = 1_800_000_000_000;
const feedback = (patch = {}) => ({
  uri: "spotify:track:a", qualifiedPlayCount: 0, completedCount: 0, skipCount: 0,
  maxListenedMs: 0, durationMs: 200_000, ...patch,
});

describe("discovery feedback", () => {
  it("reads a late skip as enjoyed and never penalizes it", () => {
    const late = interpretFeedback(feedback({
      qualifiedPlayCount: 1, maxListenedMs: 140_000, lastQualifiedAtMs: now,
      skipCount: 2, lastSkippedAtMs: now,
    }), now);
    expect(late).toMatchObject({ known: true, enjoyed: true, penalty: 0 });
  });

  it("weighs one early skip lightly, repeated skips more, and lets both fade", () => {
    const once = interpretFeedback(feedback({ skipCount: 1, lastSkippedAtMs: now }), now);
    const repeated = interpretFeedback(feedback({ skipCount: 3, lastSkippedAtMs: now }), now);
    const old = interpretFeedback(feedback({ skipCount: 3, lastSkippedAtMs: now - 150 * DAY }), now);
    expect(once).toMatchObject({ known: false, penalty: 1 });
    expect(repeated.penalty).toBe(4);
    expect(old.known).toBe(false);
    expect(old.penalty).toBeLessThan(0.1);
  });
});
