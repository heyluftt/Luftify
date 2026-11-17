import { describe, expect, it } from "vitest";
import { previousAnalyticsRangeRequest } from "../src/features/analytics/analyticsRanges";
import { change, weekdayTotals } from "../src/features/analytics/insights/insightsData";

describe("insights", () => {
  it("compares with the same stretch one period earlier", () => {
    const now = new Date(2026, 9, 2, 14, 30);
    const month = previousAnalyticsRangeRequest("thisMonth", now)!;
    expect(new Date(month.fromUnixMs)).toEqual(new Date(2026, 8, 1));
    expect(new Date(month.toUnixMs)).toEqual(new Date(2026, 8, 2, 14, 30));
    const week = previousAnalyticsRangeRequest("sevenDays", now)!;
    expect(new Date(week.toUnixMs)).toEqual(new Date(2026, 8, 26));
    // March 31 compares with the last day of February, not March 3.
    const march = previousAnalyticsRangeRequest("thisMonth", new Date(2026, 2, 31, 9, 0))!;
    expect(new Date(march.toUnixMs)).toEqual(new Date(2026, 1, 28, 9, 0));
    expect(previousAnalyticsRangeRequest("all", now)).toBeNull();
  });

  it("sums weekdays Monday first and reads changes", () => {
    const day = (date: number, minutes: number) => ({ dayStartMs: new Date(2026, 8, date).getTime(), listeningMs: minutes * 60_000, sessionCount: 1, playCount: 1 });
    // 28 September 2026 is a Monday.
    expect(weekdayTotals([day(28, 10), day(29, 5)]).slice(0, 2)).toEqual([600_000, 300_000]);
    expect(change(150, 100)).toBeCloseTo(0.5);
    expect(change(5, 0)).toBeUndefined();
  });
});
