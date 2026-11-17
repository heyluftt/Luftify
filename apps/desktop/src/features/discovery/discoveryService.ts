import { desktopApi } from "../../services/desktopApi";
import { createAnalyticsRangeRequest } from "../analytics/analyticsRanges";
import { rankDiscovery } from "./discoveryRanking";
import { discoverySources } from "./discoverySources";
import { readDiscoveryLibrary } from "./discoveryLibrary";
import { selectDiscoverySeeds } from "./discoverySeeds";
import { collectDiscoverySources } from "./collectDiscoverySources";
import { createFeedbackLookup } from "./discoveryFeedback";
import { enjoyedMixArtists } from "./discoveryChain";
import type { MediaItem } from "@luft/protocol-types";

export async function generateDiscovery(
  signal: AbortSignal,
  previousTracks: ReadonlySet<string> = new Set(),
  mixHistory: readonly { track: MediaItem }[] = [],
) {
  const check = () => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };
  check();
  const profile = await desktopApi.getListeningOverview(createAnalyticsRangeRequest("all", new Date(), 100));
  check();
  let incomplete = false;
  const heard = new Set(profile.topTracks.map(({ track }) => track.uri));
  let recentArtists: typeof profile.topArtists = [];
  try {
    const recent = await desktopApi.getListeningOverview(createAnalyticsRangeRequest("sevenDays", new Date(), 100));
    check();
    for (const { track } of recent.topTracks) heard.add(track.uri);
    recentArtists = recent.topArtists;
  } catch { check(); incomplete = true; }

  // Full local history beyond the top lists: known titles leave, skips fade out.
  const feedback = createFeedbackLookup();
  await feedback.load(mixHistory.map(({ track }) => track.uri));
  check();
  const sources = discoverySources(signal);
  const library = await readDiscoveryLibrary(signal);
  const selected = selectDiscoverySeeds(profile.topArtists, library.artists, Math.random, {
    recent: recentArtists,
    discovered: enjoyedMixArtists(mixHistory, feedback.signal),
  });
  if (!selected.length) return { picks: [], incomplete: incomplete || library.incomplete, noProfile: true };
  // Saved artists are familiar, even if they aren't in the listening top 100.
  const rankingProfile = { ...profile, topArtists: [...profile.topArtists, ...library.artists.map((creator) => ({
    creator, completedCount: 0, playCount: 0, sessionCount: 0, listeningMs: 0, lastPlayedAtMs: 0,
  }))] };
  for (const uri of library.excluded) heard.add(uri);
  sources.candidates.push(...library.candidates);
  incomplete ||= library.incomplete;
  const refreshFeedback = async () => {
    await feedback.load(sources.candidates.map(({ track }) => track.uri));
    check();
  };
  const eligible = () => sources.candidates.filter(({ track }) => !heard.has(track.uri) && !feedback.known(track.uri));
  // Count fresh selectable tracks; recent suggestions remain a fallback after the bounded search.
  const enough = async () => {
    await refreshFeedback();
    return rankDiscovery(eligible().filter(({ track }) => !previousTracks.has(track.uri)),
      rankingProfile, previousTracks, () => 0, feedback.penalty).length >= 20;
  };
  await collectDiscoverySources(selected, sources.collect, enough);
  await refreshFeedback();
  return {
    picks: rankDiscovery(eligible(), rankingProfile, previousTracks, Math.random, feedback.penalty),
    incomplete: incomplete || sources.incomplete,
    noProfile: false,
  };
}
