import { desktopApi } from "../../services/desktopApi";
import type { TrackListeningFeedback } from "../analytics/analyticsTypes";

const DAY_MS = 86_400_000;
// Suggestions fade back in over time; no signal here excludes a title forever.
const SKIP_HALF_LIFE_MS = 21 * DAY_MS;
const SAMPLED_HALF_LIFE_MS = 45 * DAY_MS;
// Leaving late because the outro drags on still means the title landed.
const ENJOYED_PROGRESS = 0.6;
// One early skip is often just impatience; only repeated skips speak clearly.
const SKIP_PENALTY = [0, 1, 2.5, 4] as const;
const LOOKUP_BATCH = 400;

export interface TrackSignal {
  /** Finished, heard far enough or repeatedly: not a discovery anymore. */
  known: boolean;
  enjoyed: boolean;
  enjoyedAtMs?: number;
  penalty: number;
}

export function interpretFeedback(feedback: TrackListeningFeedback, now: number): TrackSignal {
  const progress = feedback.durationMs ? feedback.maxListenedMs / feedback.durationMs : 0;
  const enjoyed = feedback.completedCount > 0 || progress >= ENJOYED_PROGRESS;
  const known = enjoyed || feedback.qualifiedPlayCount >= 2;
  const decay = (at: number | null | undefined, halfLife: number) =>
    at ? 0.5 ** (Math.max(0, now - at) / halfLife) : 0;
  // A title that landed once isn't penalized for being skipped later.
  const skipped = enjoyed ? 0
    : SKIP_PENALTY[Math.min(3, feedback.skipCount)]! * decay(feedback.lastSkippedAtMs, SKIP_HALF_LIFE_MS);
  // Heard past the intro but left before the enjoyed mark: a weak, slow-fading hint.
  const sampled = !known && feedback.qualifiedPlayCount === 1
    ? decay(feedback.lastQualifiedAtMs, SAMPLED_HALF_LIFE_MS)
    : 0;
  return {
    known,
    enjoyed,
    ...(enjoyed && feedback.lastQualifiedAtMs ? { enjoyedAtMs: feedback.lastQualifiedAtMs } : {}),
    penalty: skipped + sampled,
  };
}

// Local SQLite lookups only. Failure keeps discovery working without the signal.
export function createFeedbackLookup(now = Date.now()) {
  const signals = new Map<string, TrackSignal>();
  const checked = new Set<string>();
  let available = true;
  async function load(uris: Iterable<string>) {
    const missing = [...new Set(uris)].filter((uri) => !checked.has(uri));
    for (let index = 0; available && index < missing.length; index += LOOKUP_BATCH) {
      const batch = missing.slice(index, index + LOOKUP_BATCH);
      try {
        for (const feedback of await desktopApi.trackListeningFeedback(batch)) {
          signals.set(feedback.uri, interpretFeedback(feedback, now));
        }
        for (const uri of batch) checked.add(uri);
      } catch { available = false; }
    }
  }
  return {
    load,
    signal: (uri: string) => signals.get(uri),
    known: (uri: string) => signals.get(uri)?.known ?? false,
    penalty: (uri: string) => signals.get(uri)?.penalty ?? 0,
  };
}
