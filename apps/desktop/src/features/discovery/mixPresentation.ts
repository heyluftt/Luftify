import { appLanguage, t } from "../../i18n";
import type { SavedMix } from "./mixLibrary";

const DAY_MS = 86_400_000;
const FRESH_MIX_MS = 3 * DAY_MS;
const normalize = (name: string) => name.normalize("NFKC").trim().toLowerCase();

export const mixContextUri = (mix: Pick<SavedMix, "id">) => `spotify:search:luftify-discovery-${mix.id}`;

function leadArtists(mix: SavedMix, count: number): string[] {
  const names = new Map<string, string>();
  for (const { track } of mix.picks) {
    const name = track.creators[0]?.name.trim();
    if (name && !names.has(normalize(name))) names.set(normalize(name), name);
    if (names.size >= count) break;
  }
  return [...names.values()];
}

/** A custom name wins; otherwise the mix is named after its leading artists. */
export function mixTitle(mix: SavedMix): string {
  if (mix.name) return mix.name;
  const [first, second] = leadArtists(mix, 2);
  if (first && second) return t("discovery.mixWith", { first, second });
  return first ?? t("discovery.mixFallback");
}

/** "New" only while the mix is actually recent, not merely the newest one. */
export const isFreshMix = (mix: SavedMix, now = Date.now()) => now - mix.createdAt < FRESH_MIX_MS;

export function mixAge(mix: SavedMix, now = Date.now()): string {
  const created = new Date(mix.createdAt);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(created);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / DAY_MS);
  if (days > 27) return created.toLocaleDateString(appLanguage(), { day: "numeric", month: "short" });
  return new Intl.RelativeTimeFormat(appLanguage(), { numeric: "auto" }).format(-days, "day");
}

export function mixSummary(mix: SavedMix): string {
  const count = mix.picks.length;
  const tracks = t(count === 1 ? "discovery.countOne" : "discovery.count", { count });
  const novel = new Set(mix.picks.filter((pick) => pick.novel)
    .map(({ track }) => normalize(track.creators[0]?.name ?? ""))
    .filter(Boolean)).size;
  if (!novel) return tracks;
  return `${tracks} · ${t(novel === 1 ? "discovery.newArtistsOne" : "discovery.newArtists", { count: novel })}`;
}
