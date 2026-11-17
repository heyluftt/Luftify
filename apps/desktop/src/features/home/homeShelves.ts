import type { EntitySummary } from "@luft/protocol-types";
import {
  isDailyMix,
  isDaylist,
  isOnRepeat,
  isReleaseRadar,
  isTimeCapsule,
  isWeeklyMix,
} from "./homeNames";

export type HomeShelfId = "mixes" | "weekly" | "radar" | "repeat";

export interface HomeShelf {
  id: HomeShelfId;
  eyebrow: string;
  title: string;
  description?: string;
  items: EntitySummary[];
}

export function buildHomeShelves(
  playlists: EntitySummary[],
  excludeUris: ReadonlySet<string> = new Set(),
): HomeShelf[] {
  const available = playlists.filter((playlist) => !excludeUris.has(playlist.uri));
  const mixes = available.filter((playlist) => isDailyMix(playlist) || isDaylist(playlist));
  const weekly = available.filter(isWeeklyMix);
  const radar = available.filter(isReleaseRadar);
  const repeat = available.filter((playlist) => isOnRepeat(playlist) || isTimeCapsule(playlist));

  return [
    shelf("mixes", "Für dich", "Dein Mix", "Tägliche Zusammenstellungen", mixes),
    shelf("radar", "Neu", "Release Radar", "Neue Musik von deinen Künstlern", radar),
    shelf("weekly", "Entdecken", "Wöchentlich neu", "Frisch kuratiert", weekly),
    shelf("repeat", "Nochmal", "Auf Repeat", "Was dich gerade nicht loslässt", repeat),
  ].filter((entry) => entry.items.length > 0);
}

function shelf(
  id: HomeShelfId,
  eyebrow: string,
  title: string,
  description: string,
  items: EntitySummary[],
): HomeShelf {
  return { id, eyebrow, title, description, items: items.slice(0, 6) };
}
