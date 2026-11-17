import { describe, expect, it } from "vitest";

import {
  activityGranularity,
  calendarBuckets,
  hourlyBuckets,
} from "../src/features/analytics/activityBuckets";
import { peakDaypart } from "../src/features/analytics/peakDaypart";

const DAY = 86_400_000;
// Monday, 1 September 2025, 00:00 UTC.
const MONDAY = Date.UTC(2025, 8, 1);

describe("listening activity buckets", () => {
  it("picks hours for today, days up to ~3 months, weeks for a year, months beyond", () => {
    expect(activityGranularity("today", 1)).toBe("hour");
    expect(activityGranularity("ninetyDays", 90)).toBe("day");
    expect(activityGranularity("thisYear", 270)).toBe("week");
    expect(activityGranularity("all", 900)).toBe("month");
  });

  it("sums days into Monday weeks and keeps silent weeks", () => {
    const activity = [0, 2, 16].map((offset) => ({
      dayStartMs: MONDAY + offset * DAY, listeningMs: 60_000, sessionCount: 1, playCount: 1,
    }));
    const weeks = calendarBuckets(activity, MONDAY, MONDAY + 20 * DAY, 0, "week");

    expect(weeks.map((week) => week.listeningMs)).toEqual([120_000, 0, 60_000]);
    expect(weeks[1]!.start).toBe(MONDAY + 7 * DAY);
  });

  it("groups months by the local calendar", () => {
    const activity = [
      { dayStartMs: Date.UTC(2025, 0, 31), listeningMs: 1_000, sessionCount: 1, playCount: 1 },
      { dayStartMs: Date.UTC(2025, 1, 1), listeningMs: 2_000, sessionCount: 1, playCount: 1 },
    ];
    const months = calendarBuckets(activity, Date.UTC(2025, 0, 1), Date.UTC(2025, 1, 10), 0, "month");
    expect(months.map((month) => month.listeningMs)).toEqual([1_000, 2_000]);
  });

  it("always shows all 24 hours", () => {
    const hours = hourlyBuckets([{ hour: 21, listeningMs: 5_000, playCount: 1 }]);
    expect(hours).toHaveLength(24);
    expect(hours[21]!.listeningMs).toBe(5_000);
    expect(hours[3]!.listeningMs).toBe(0);
  });
});

describe("listening profile", () => {
  it("finds the evening and its strongest hour", () => {
    expect(peakDaypart([
      { hour: 8, listeningMs: 60_000, playCount: 1 },
      { hour: 20, listeningMs: 90_000, playCount: 1 },
      { hour: 21, listeningMs: 200_000, playCount: 2 },
    ])).toEqual({ daypart: "evening", hour: 21 });
    expect(peakDaypart([])).toBeUndefined();
  });
});
