import { STRONG_COMMAND_SCORE, rankCommands, searchFallback } from "./commandPaletteModel";
import type { PaletteItem } from "./paletteTypes";

/** A leading ">" limits the palette to commands, like in code editors. */
export function parsePaletteQuery(query: string): { text: string; commandsOnly: boolean } {
  const commandsOnly = query.trimStart().startsWith(">");
  return { text: commandsOnly ? query.trimStart().slice(1).trim() : query.trim(), commandsOnly };
}

/**
 * Everything the palette lists, in display order.
 *
 * Empty: recent runs, often played playlists, playback and pages.
 * Typing: direct actions ("laut 40"), well-named commands, the library,
 * Spotify, weaker command matches, and finally the full search.
 */
export function assemblePaletteItems(input: {
  query: string;
  catalog: PaletteItem[];
  recent: PaletteItem[];
  intents: PaletteItem[];
  suggested: PaletteItem[];
  library: PaletteItem[];
  spotify: PaletteItem[];
  boost: (id: string) => number;
}): PaletteItem[] {
  const { text, commandsOnly } = parsePaletteQuery(input.query);
  if (!text) {
    const taken = new Set(input.recent.map((item) => item.id.replace(/^recent:/, "")));
    const fresh = (item: PaletteItem) => !taken.has(item.id);
    const everyday = input.catalog.filter((item) => item.group === "playback" || item.group === "navigate");
    return [
      ...(commandsOnly ? input.recent.filter((item) => item.action.kind !== "media") : input.recent),
      ...(commandsOnly ? [] : input.suggested.filter(fresh)),
      ...everyday.filter(fresh),
    ];
  }

  // A pasted link stands alone: its text matches no command and searches nothing.
  if (input.intents[0]?.group === "link") return input.intents;

  const ranked = rankCommands(input.catalog, text, input.boost, commandsOnly ? 14 : 7);
  const strong = ranked.filter(({ score }) => commandsOnly || score >= STRONG_COMMAND_SCORE);
  const weak = ranked.filter((entry) => !strong.includes(entry)).slice(0, 3);
  return [
    ...input.intents,
    ...strong.map(({ item }) => ({ ...item, group: "commands" as const })),
    ...(commandsOnly ? [] : input.library),
    ...(commandsOnly ? [] : input.spotify),
    ...weak.map(({ item }) => ({ ...item, group: "commands-late" as const })),
    ...(commandsOnly ? [] : [searchFallback(text)]),
  ];
}
