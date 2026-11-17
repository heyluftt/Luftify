import { describe, expect, it } from "vitest";
import {
  createAnalyticsRange,
  createAnalyticsRangeRequest,
} from "../src/features/analytics/analyticsRanges";

describe("analytics ranges", () => {
  const now = new Date(2026, 6, 30, 14, 35, 12, 400);

  it("uses the current local month by default", () => {
    const range = createAnalyticsRange("thisMonth", now);

    expect(range.label).toBe("Monat");
    expect(range.request.fromUnixMs).toBe(new Date(2026, 6, 1).getTime());
    expect(range.request.toUnixMs).toBe(now.getTime());
  });

  it.each([
    ["today", new Date(2026, 6, 30).getTime()],
    ["sevenDays", new Date(2026, 6, 24).getTime()],
    ["ninetyDays", new Date(2026, 4, 2).getTime()],
    ["thisYear", new Date(2026, 0, 1).getTime()],
    ["all", 0],
  ] as const)("builds the %s boundary in local time", (key, expectedStart) => {
    expect(createAnalyticsRangeRequest(key, now).fromUnixMs).toBe(expectedStart);
  });

  it("sends a bounded result count and the local UTC offset", () => {
    const request = createAnalyticsRangeRequest("sevenDays", now, 18);

    expect(request.limit).toBe(18);
    expect(request.timezoneOffsetMinutes).toBe(-now.getTimezoneOffset());
  });
});
