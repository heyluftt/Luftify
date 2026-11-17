import { describe, expect, it } from "vitest";
import { recapActivity, recapHours } from "../src/features/recap/recapChartData";
import type { RecapPeriod } from "../src/features/recap/recapTypes";

const DAY = 86_400_000;
const from = new Date(2026, 8, 21).getTime();
const period = (days: number): RecapPeriod => ({
  id: "p", kind: "week", fromMs: from, toMs: from + days * DAY, title: "", eyebrow: "", dates: "",
  listeningMs: 0, playCount: 0, fresh: false,
});
const day = (offset: number, listeningMs: number) => ({ dayStartMs: from + offset * DAY, listeningMs, sessionCount: 1, playCount: 1 });

describe("recap chart data", () => {
  it("shows a week day by day, empty days included, and finds the peak", () => {
    const activity = recapActivity([day(0, 60), day(3, 300), day(6, 10)], period(7), "de-DE");
    expect(activity.unit).toBe("day");
    expect(activity.bars.map((bar) => bar.value)).toEqual([60, 0, 0, 300, 0, 0, 10]);
    expect(activity.peak).toBe(3);
    expect(activity.bars[0]!.label).toBe("Mo");
  });

  it("groups a season by week and a year by month", () => {
    const season = recapActivity([day(0, 10), day(6, 10), day(7, 5)], period(92), "de-DE");
    expect(season.unit).toBe("week");
    expect(season.bars).toHaveLength(14);
    expect(season.bars.slice(0, 2).map((bar) => bar.value)).toEqual([20, 5]);

    const year = recapActivity([day(0, 10), day(40, 20)], period(365), "de-DE");
    expect(year.unit).toBe("month");
    expect(year.bars.length).toBeGreaterThanOrEqual(12);
    expect(year.bars[0]!.value).toBe(10);
  });

  it("reports no peak without listening and sums hours", () => {
    expect(recapActivity([], period(7), "de-DE").peak).toBe(-1);
    const hours = recapHours([{ hour: 22, listeningMs: 5, playCount: 1 }, { hour: 22, listeningMs: 3, playCount: 1 }, { hour: 30, listeningMs: 9, playCount: 1 }]);
    expect(hours).toHaveLength(24);
    expect(hours[22]).toBe(8);
  });
});
