import type { EntitySummary } from "@luft/protocol-types";
import { appLanguage, t } from "../../i18n";
import type { HomeFeatureMode, PlaylistUsage } from "../../types/tauri";
import { isWeeklyMix, normalizePlaylistName, personalizedScore } from "./homeNames";

export { isWeeklyMix } from "./homeNames";

export type HomeFeatureSource = HomeFeatureMode | "library";

const locale = () => (appLanguage() === "en" ? "en-US" : "de-DE");

export function selectHomeFeature(
  playlists: EntitySummary[],
  mode: HomeFeatureMode = "lastPlayed",
  usage: PlaylistUsage[] = [],
  fixedUri?: string,
): EntitySummary | undefined {
  if (playlists.length === 0) return undefined;
  const byUri = new Map(playlists.map((playlist) => [playlist.uri, playlist]));
  if (mode === "fixed" && fixedUri && byUri.has(fixedUri)) return byUri.get(fixedUri);
  if (mode === "personalized") return selectPersonalizedPlaylists(playlists)[0] ?? firstOrdinaryPlaylist(playlists);
  const rankedUsage = [...usage].sort(mode === "mostPlayed"
    ? (left, right) => right.playCount - left.playCount || right.lastPlayedAt - left.lastPlayedAt
    : (left, right) => right.lastPlayedAt - left.lastPlayedAt || right.playCount - left.playCount);
  for (const entry of rankedUsage) {
    const playlist = byUri.get(entry.playlistUri);
    if (playlist) return playlist;
  }
  return firstOrdinaryPlaylist(playlists);
}

export function orderPlaylistsByUsage(playlists: EntitySummary[], usage: PlaylistUsage[]): EntitySummary[] {
  const byUri = new Map(playlists.map((playlist) => [playlist.uri, playlist]));
  const used = [...usage]
    .sort((left, right) => right.lastPlayedAt - left.lastPlayedAt || right.playCount - left.playCount)
    .flatMap((entry) => {
      const playlist = byUri.get(entry.playlistUri);
      return playlist ? [playlist] : [];
    });
  const usedUris = new Set(used.map((playlist) => playlist.uri));
  return [...used, ...playlists.filter((playlist) => !usedUris.has(playlist.uri))];
}

export function selectPersonalizedPlaylists(playlists: EntitySummary[]): EntitySummary[] {
  return [...playlists]
    .filter((playlist) => personalizedScore(playlist) > 0)
    .sort((left, right) => personalizedScore(right) - personalizedScore(left));
}

export function recentPlaylistDescription(
  playlist: EntitySummary,
  usage: PlaylistUsage[],
  nowUnixSeconds = Math.floor(Date.now() / 1_000),
): string {
  const entry = usage.find((item) => item.playlistUri === playlist.uri);
  if (!entry) return playlistSubtitle(playlist);

  const count = Math.max(0, entry.playCount);
  const countLabel = count === 1
    ? t("home.onePlay")
    : t("home.plays", { n: new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(count) });
  if (entry.lastPlayedAt <= 0) return countLabel;

  const elapsedSeconds = Math.max(0, nowUnixSeconds - entry.lastPlayedAt);
  let recency: string;
  if (elapsedSeconds < 5 * 60) {
    recency = t("home.justPlayed");
  } else if (elapsedSeconds < 60 * 60) {
    recency = t("home.minutesAgo", { n: Math.max(1, Math.floor(elapsedSeconds / 60)) });
  } else if (elapsedSeconds < 24 * 60 * 60) {
    recency = t("home.hoursAgo", { n: Math.max(1, Math.floor(elapsedSeconds / (60 * 60))) });
  } else if (elapsedSeconds < 7 * 24 * 60 * 60) {
    const days = Math.max(1, Math.floor(elapsedSeconds / (24 * 60 * 60)));
    recency = days === 1 ? t("home.dayAgo") : t("home.daysAgo", { n: days });
  } else {
    const date = new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "2-digit" })
      .format(new Date(entry.lastPlayedAt * 1_000));
    recency = t("home.lastOn", { date });
  }

  return `${recency} · ${countLabel}`;
}

export function resolveHomeFeatureSource(
  mode: HomeFeatureMode,
  playlist: EntitySummary,
  usage: PlaylistUsage[],
  fixedUri?: string,
): HomeFeatureSource {
  if (mode === "fixed") return fixedUri === playlist.uri ? "fixed" : "library";
  if (mode === "personalized") {
    return personalizedScore(playlist) > 0 ? "personalized" : "library";
  }
  return usage.some((entry) => entry.playlistUri === playlist.uri)
    ? mode
    : "library";
}

export function homeFeatureLabel(source: HomeFeatureSource, playlist: EntitySummary): string {
  if (source === "mostPlayed") return t("home.oftenPlayed");
  if (source === "fixed") return t("home.yourPick");
  if (source === "personalized") return isWeeklyMix(playlist) ? t("home.weeklyForYou") : t("home.personalMix");
  if (source === "library") return t("home.fromLibrary");
  return t("home.lastPlayed");
}

export function hasPreferredCandidate(
  playlists: EntitySummary[],
  mode: HomeFeatureMode,
  usage: PlaylistUsage[],
  fixedUri?: string,
): boolean {
  if (mode === "fixed") return !fixedUri || playlists.some((playlist) => playlist.uri === fixedUri);
  if (mode === "personalized") return selectPersonalizedPlaylists(playlists).length > 0;
  if (usage.length === 0) return true;
  const uris = new Set(playlists.map((playlist) => playlist.uri));
  return usage.some((entry) => uris.has(entry.playlistUri));
}

function firstOrdinaryPlaylist(playlists: EntitySummary[]): EntitySummary {
  return playlists.find((playlist) => personalizedScore(playlist) === 0) ?? playlists[0]!;
}

function playlistSubtitle(playlist: EntitySummary): string {
  const subtitle = playlist.subtitle?.trim();
  return subtitle && normalizePlaylistName(subtitle) !== "playlist"
    ? subtitle
    : "Playlist aus deiner Bibliothek";
}
