import { describe, expect, it } from "vitest";
import type { DailyListeningActivity, ListeningOverview } from "../src/features/analytics/analyticsTypes";
import { buildRecapCatalog } from "../src/features/recap/recapPeriods";
import { longestStreak, recapFacts, recapSlides } from "../src/features/recap/recapPlan";
import { heatmapWeeks, recapYears, yearStats } from "../src/features/recap/page/recapArchive";
import { soundtrackPlan, soundtrackVolume } from "../src/features/recap/recapSoundtrack";
import type { ListeningRecap, RecapPeriod } from "../src/features/recap/recapTypes";

const HOUR = 3_600_000;

/** One listening day at local midnight, like the database reports them. */
function day(year: number, month: number, date: number, hours: number, plays = 20): DailyListeningActivity {
  return { dayStartMs: new Date(year, month, date).getTime(), listeningMs: hours * HOUR, sessionCount: plays, playCount: plays };
}

function everyDay(fromMonth: number, fromDate: number, count: number, hours = 2): DailyListeningActivity[] {
  return Array.from({ length: count }, (_, index) => day(2026, fromMonth, fromDate + index, hours));
}

describe("recap catalog", () => {
  it("offers finished weeks and months, marks the newest as fresh and skips thin ones", () => {
    // 30 July to 29 September 2026, two hours a day.
    const days = everyDay(6, 30, 62);
    const now = new Date(2026, 8, 29, 12);
    const catalog = buildRecapCatalog(days, now);
    const months = catalog.filter((period) => period.kind === "month");
    // July has only two listening days: too few for a month.
    expect(months.map((period) => period.id)).toEqual(["month:2026-08"]);
    const august = months[0]!;
    expect(august.fresh).toBe(false);
    expect(august.previousFromMs).toBe(new Date(2026, 6, 1).getTime());
    const weeks = catalog.filter((period) => period.kind === "week");
    expect(weeks[0]!.id).toBe("week:2026-09-21");
    expect(weeks[0]!.fresh).toBe(true);
    expect(weeks.every((period) => period.toMs <= new Date(2026, 8, 28).getTime())).toBe(true);
    // Summer ended on 1 September; July 30/31 + August are enough.
    expect(catalog.some((period) => period.id === "season:2026-summer")).toBe(true);
  });

  it("celebrates hour milestones and offers the year so far in December", () => {
    const days = everyDay(6, 30, 60, 2);
    const catalog = buildRecapCatalog(days, new Date(2026, 11, 2));
    expect(catalog.some((period) => period.id === "milestone:hours-100")).toBe(true);
    const year = catalog.find((period) => period.id === "year:2026-so-far");
    expect(year?.provisional).toBe(true);
    expect(catalog.some((period) => period.id === "milestone:days-100")).toBe(true);
  });

  it("returns nothing without history", () => {
    expect(buildRecapCatalog([], new Date())).toEqual([]);
  });
});

function overview(partial: Partial<ListeningOverview>): ListeningOverview {
  return {
    fromUnixMs: 0, toUnixMs: 0, totalListeningMs: 10 * HOUR, sessionCount: 200, qualifiedPlayCount: 150,
    completedPlayCount: 120, uniqueTrackCount: 60, uniqueArtistCount: 30, uniquePlaylistCount: 4,
    topTracks: [], topArtists: [], topPlaylists: [], dailyActivity: [], hourlyActivity: [],
    behavior: { averageSessionMs: 0, longestSessionMs: 0, skipCount: 0, seekCount: 0, pauseCount: 0, repeatCount: 0, activeDayCount: 0, completionRate: 0 },
    ...partial,
  };
}

const period: RecapPeriod = {
  id: "month:2026-09", kind: "month", fromMs: new Date(2026, 8, 1).getTime(), toMs: new Date(2026, 9, 1).getTime(),
  title: "September 2026", eyebrow: "", dates: "", listeningMs: 10 * HOUR, playCount: 150, fresh: true,
};

describe("recap story plan", () => {
  it("compares with the period before and finds the longest streak", () => {
    const days = [day(2026, 8, 1, 1), day(2026, 8, 2, 3), day(2026, 8, 3, 1), day(2026, 8, 5, 2)];
    const recap: ListeningRecap = {
      overview: overview({ dailyActivity: days, hourlyActivity: [{ hour: 23, listeningMs: 5 * HOUR, playCount: 60 }] }),
      previousListeningMs: 8 * HOUR, newArtistCount: 0, newTrackCount: 0,
    };
    const facts = recapFacts(recap, period);
    expect(facts.change).toBeCloseTo(0.25);
    expect(facts.longestStreak).toBe(3);
    expect(facts.activeDays).toBe(4);
    expect(facts.busiestDay?.listeningMs).toBe(3 * HOUR);
    expect(facts.daypart).toBe("late");
    expect(longestStreak([])).toBe(0);
  });

  it("only tells stories the data carries", () => {
    const track = { uri: "spotify:track:a", itemType: "track", title: "A", creators: [{ name: "X" }] };
    const stat = { track, listeningMs: HOUR, sessionCount: 10, playCount: 10, completedCount: 9, lastPlayedAtMs: 0 };
    const bare: ListeningRecap = { overview: overview({}), newArtistCount: 3, newTrackCount: 5, historyStartedAtMs: period.fromMs - 86_400_000 };
    expect(recapSlides(bare, period, recapFacts(bare, period))).toEqual(["intro", "time", "summary"]);

    const rich: ListeningRecap = {
      overview: overview({
        topTracks: [stat, stat, stat],
        topArtists: [{ creator: { name: "X" }, listeningMs: HOUR, sessionCount: 1, playCount: 1, completedCount: 1, lastPlayedAtMs: 0 }],
        hourlyActivity: [{ hour: 8, listeningMs: HOUR, playCount: 3 }],
      }),
      newArtistCount: 3, newTrackCount: 5, historyStartedAtMs: period.fromMs - 40 * 86_400_000,
      onRepeat: { track, dayStartMs: period.fromMs, playCount: 6 },
      topAlbum: { albumName: "Album", listeningMs: HOUR, playCount: 4 },
    };
    expect(recapSlides(rich, period, recapFacts(rich, period))).toEqual([
      "intro", "time", "topTrack", "topTracks", "topArtist", "discoveries", "onRepeat", "rhythm", "places", "summary",
    ]);
  });
});

describe("recap soundtrack", () => {
  const song = (id: string, artist: string) => ({
    track: { uri: `spotify:track:${id}`, itemType: "track", title: id, creators: [{ name: artist }] },
    listeningMs: HOUR, sessionCount: 1, playCount: 1, completedCount: 1, lastPlayedAtMs: 0,
  });

  it("gives each page the song it is about and keeps the top song running at the start", () => {
    const recap: ListeningRecap = {
      overview: overview({
        topTracks: [song("a", "X"), song("b", "Y"), song("c", "Z"), song("d", "Y")],
        topArtists: [{ creator: { name: "Y" }, listeningMs: HOUR, sessionCount: 1, playCount: 1, completedCount: 1, lastPlayedAtMs: 0 }],
      }),
      newArtistCount: 1, newTrackCount: 1,
      topDiscovery: { track: song("new", "N").track, playCount: 5 },
      onRepeat: { track: song("loop", "L").track, dayStartMs: 0, playCount: 9 },
    };
    expect(soundtrackPlan(["intro", "time", "topTrack", "topTracks", "topArtist", "discoveries", "onRepeat", "rhythm", "summary"], recap)).toEqual([
      "spotify:track:a", "spotify:track:a", "spotify:track:a", "spotify:track:b", "spotify:track:b",
      // Rhythm brings #3; the summary keeps it running instead of bringing in another song.
      "spotify:track:new", "spotify:track:loop", "spotify:track:c", "spotify:track:c",
    ]);
    // Songs below the top five never fill in.
    const many: ListeningRecap = {
      ...recap,
      overview: overview({ topTracks: ["a", "b", "c", "d", "e", "f", "g"].map((id) => song(id, "X")), topArtists: [] }),
      topDiscovery: { track: song("b", "X").track, playCount: 3 }, onRepeat: { track: song("c", "X").track, dayStartMs: 0, playCount: 5 },
    };
    expect(soundtrackPlan(["intro", "topTracks", "discoveries", "onRepeat", "rhythm", "places", "summary"], many)).toEqual([
      "spotify:track:a", "spotify:track:b", "spotify:track:b", "spotify:track:c", "spotify:track:c", "spotify:track:d", "spotify:track:d",
    ]);
    // Nothing unheard left: the current song simply keeps going.
    const two: ListeningRecap = { ...recap, overview: overview({ topTracks: [song("a", "X"), song("b", "Y")] }), topDiscovery: null, onRepeat: null };
    expect(soundtrackPlan(["intro", "topTracks", "rhythm", "summary"], two)).toEqual([
      "spotify:track:a", "spotify:track:b", "spotify:track:b", "spotify:track:b",
    ]);
    expect(soundtrackPlan(["intro", "summary"], { overview: overview({}), newArtistCount: 0, newTrackCount: 0 })).toEqual([undefined, undefined]);
  });

  it("stays clearly below the player volume and silent when muted", () => {
    expect(soundtrackVolume(0)).toBe(0);
    expect(soundtrackVolume(1)).toBeCloseTo(0.5);
    // At 60 % on the slider the clip stays well below half volume.
    expect(soundtrackVolume(0.6)).toBeLessThan(0.2);
    expect(soundtrackVolume(undefined)).toBeLessThan(soundtrackVolume(0.6));
  });
});

describe("recap archive", () => {
  it("sorts recaps into years, months and a listening calendar", () => {
    const days = everyDay(7, 1, 120);
    const now = new Date(2026, 10, 15);
    const years = recapYears(buildRecapCatalog(days, now), days, now);
    expect(years.map((year) => year.year)).toEqual([2026]);
    const [year] = years;
    // August to October are finished months; November still runs.
    expect(year!.months.map((month) => Boolean(month))).toEqual([false, false, false, false, false, false, false, true, true, true, false, false]);
    expect(year!.seasons.some((season) => season.id === "season:2026-summer")).toBe(true);

    const grid = heatmapWeeks(days, 2026, now);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    const cells = grid.flat().filter((cell) => !cell.outside);
    expect(cells).toHaveLength(365);
    expect(cells.filter((cell) => cell.level > 0)).toHaveLength(days.length);
    expect(cells.find((cell) => cell.date.getMonth() === 11)?.future).toBe(true);
    expect(yearStats(days, 2026).activeDays).toBe(120);
  });
});
