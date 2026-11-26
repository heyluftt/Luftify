import type { PlaybackState } from "@luft/protocol-types";
import { t, type MessageKey } from "../../i18n";
import type { ThemeMode } from "../../themes/theme";
import { EQUALIZER_PRESETS } from "../audio-control/equalizerPresets";
import { SPATIAL_PRESETS } from "../audio-control/spatialPresets";
import { albumDestination, contextDestination } from "../entities/mediaDestinations";
import { matchKey } from "../textMatch";
import type { PaletteGroup, PaletteItem } from "./paletteTypes";

export const PALETTE_GROUP_LABEL: Record<PaletteGroup, MessageKey> = {
  link: "command.group.link",
  intent: "command.group.intent",
  recent: "command.group.recent",
  suggested: "command.group.suggested",
  playback: "command.playback",
  commands: "command.commands",
  "commands-late": "command.commands",
  library: "command.group.library",
  spotify: "command.group.spotify",
  navigate: "command.navigate",
  sound: "command.group.sound",
  appearance: "command.appearance",
  search: "command.search",
};

/** Order of the sections; commands of several groups share one while typing. */
const GROUP_ORDER: PaletteGroup[] = [
  "link", "intent", "recent", "suggested", "playback", "commands", "library", "spotify", "navigate", "sound", "appearance",
  "commands-late", "search",
];

/** A command named this well leads while typing; weaker ones follow the music. */
export const STRONG_COMMAND_SCORE = 50;

const THEME_COMMANDS: Array<{ id: ThemeMode; nameKey: MessageKey; keywords: string[] }> = [
  { id: "light", nameKey: "settings.theme.light", keywords: ["hell", "light", "tag"] },
  { id: "atelier", nameKey: "settings.theme.atelier", keywords: ["atelier", "papier", "hell"] },
  { id: "dark", nameKey: "settings.theme.dark", keywords: ["dunkel", "dark", "nacht"] },
  { id: "luft", nameKey: "settings.theme.luft", keywords: ["violet", "luft", "lila"] },
  { id: "redline", nameKey: "settings.theme.redline", keywords: ["redline", "rot", "kontrast", "glut", "feuer"] },
  { id: "rose", nameKey: "settings.theme.rose", keywords: ["rose", "rosa", "pink", "perlmutt", "nocturne", "samt", "vanity"] },
  { id: "polaris", nameKey: "settings.theme.polaris", keywords: ["polaris", "sterne", "stern", "nacht", "polarstern", "himmel"] },
  { id: "prisma", nameKey: "settings.theme.prisma", keywords: ["prisma", "cover", "farbe", "dynamisch", "matt", "pigment"] },
  { id: "abyss", nameKey: "settings.theme.abyss", keywords: ["tiefsee", "meer", "ozean", "qualle", "quallen", "unterwasser", "deep", "sea", "abyss", "leuchten"] },
  { id: "aeris", nameKey: "settings.theme.aeris", keywords: ["aeris", "wind", "luft", "air", "brise", "breeze", "wolken", "hell", "sky"] },
  { id: "pixelpop", nameKey: "settings.theme.pixelpop", keywords: ["pixelpop", "pixel", "retro", "8-bit", "8bit", "konsole", "console", "spiel", "game", "arcade"] },
  { id: "modular", nameKey: "settings.theme.modular", keywords: ["modular", "synth", "synthesizer", "kabel", "cable", "patch", "eurorack", "led", "oszilloskop"] },
  { id: "calamus", nameKey: "settings.theme.calamus", keywords: ["calamus", "kladde", "rohr", "feder", "tinte", "schlicht", "latein", "standard", "default"] },
];

const PAGES: Array<{ id: string; path: string; label: MessageKey; icon: PaletteItem["icon"]; keywords: string[]; hint?: string }> = [
  { id: "nav-home", path: "/", label: "nav.home", icon: "home", keywords: ["home", "startseite", "start"], hint: "G" },
  { id: "nav-search", path: "/search", label: "nav.search", icon: "search", keywords: ["suche", "search"], hint: "/" },
  { id: "nav-library", path: "/library", label: "nav.library", icon: "library", keywords: ["library", "bibliothek", "playlists"], hint: "Ctrl L" },
  { id: "nav-liked", path: "/liked", label: "library.liked", icon: "liked", keywords: ["liked", "favoriten", "saved", "lieblings"] },
  { id: "nav-lyrics", path: "/lyrics", label: "nav.lyrics", icon: "lyrics", keywords: ["lyrics", "text", "songtext", "worte"] },
  { id: "nav-insights", path: "/insights", label: "nav.insights", icon: "insights", keywords: ["analyse", "statistik", "insights", "hörverhalten"] },
  { id: "nav-recaps", path: "/recaps", label: "nav.recaps", icon: "recaps", keywords: ["rückblick", "recap", "wrapped", "jahresrückblick", "monat", "woche"] },
  { id: "nav-listen", path: "/listen", label: "nav.listenTogether", icon: "listen", keywords: ["listen", "together", "zusammen", "raum", "sync"] },
  { id: "nav-modules", path: "/modules", label: "nav.modules", icon: "modules", keywords: ["audio", "module", "equalizer", "eq"] },
  { id: "nav-settings", path: "/settings", label: "nav.settings", icon: "settings", keywords: ["settings", "einstellungen", "optionen"], hint: "Ctrl ," },
  { id: "nav-diagnostics", path: "/diagnostics", label: "nav.diagnostics", icon: "diagnostics", keywords: ["debug", "status", "diagnose", "bericht"] },
];

export function buildCommandCatalog(input: {
  pathname: string;
  connected: boolean;
  playback?: PlaybackState;
  soundEnabled: boolean;
  equalizerPresetId?: string;
  roomPresetId?: string;
  theme?: ThemeMode;
}): PaletteItem[] {
  const playback = input.playback;
  const item = playback?.currentItem;
  const album = item ? albumDestination(item) : undefined;
  const context = contextDestination(playback?.contextUri);
  const artist = item?.creators.find((creator) => creator.uri?.startsWith("spotify:artist:"));
  const playing = playback?.isPlaying === true;
  const offline = !input.connected;
  const repeat = playback?.repeatMode ?? "off";

  const commands: PaletteItem[] = [
    command("play-toggle", playing ? t("command.pause") : t("command.play"), playing ? "pause" : "play",
      ["play", "pause", "wiedergabe", "start", "stopp", "weiter"], { hint: t("settings.shortcut.space"), disabled: offline || !item }),
    command("next", t("player.next"), "next", ["next", "weiter", "skip", "nächster"], { disabled: offline }),
    command("previous", t("player.previous"), "previous", ["previous", "zurück", "last", "vorheriger"], { disabled: offline }),
    command("like", playback?.isSaved ? t("player.unlike") : t("player.like"), playback?.isSaved ? "heart-off" : "heart",
      ["like", "herz", "favorit", "save", "lieblingssongs", "speichern"], { disabled: offline || !item }),
    command("shuffle", playback?.shuffleEnabled ? t("player.shuffleOff") : t("player.shuffleOn"), "shuffle",
      ["shuffle", "zufall", "mix"], { disabled: offline, active: playback?.shuffleEnabled === true }),
    command("repeat", repeatCommandLabel(repeat), repeat === "one" ? "repeat-one" : "repeat",
      ["repeat", "wiederholen", "loop"], { disabled: offline, active: repeat !== "off" }),
    command("mute", playback?.isMuted ? t("command.unmute") : t("command.mute"), "mute",
      ["mute", "stumm", "ton", "leise"], { disabled: offline }),
    command("queue-panel", t("player.openQueue"), "queue", ["queue", "warteschlange", "nächste", "als nächstes"], { hint: "Ctrl Q" }),
    command("miniplayer", t("command.miniplayer"), "miniplayer", ["miniplayer", "mini", "klein", "fenster"]),
  ];
  if (item) {
    commands.push(command("copy-link", t("command.copyLink"), "link", ["link", "teilen", "share", "kopieren", "url"]));
  }
  if (album) {
    commands.push(command("open-album", t("player.openAlbum", { label: album.label }), "album", ["album", album.label]));
  }
  if (artist) {
    commands.push(command("open-artist", t("command.openArtist", { name: artist.name }), "artist", ["künstler", "artist", artist.name]));
  }
  if (context) {
    commands.push(command("open-context", t("command.openContext"), "context", ["playlist", "kontext", "album", "quelle"]));
  }

  const current = matchKey(input.pathname.replace(/\/+$/, "") || "/");
  const pages = PAGES.filter((page) => matchKey(page.path) !== current).map((page): PaletteItem => ({
    id: page.id,
    group: "navigate",
    label: t(page.label),
    keywords: page.keywords,
    icon: page.icon,
    ...(page.hint ? { hint: page.hint } : {}),
    action: { kind: "navigate", path: page.path },
  }));

  const soundOff = !input.soundEnabled;
  const sound: PaletteItem[] = [
    ...EQUALIZER_PRESETS.map((preset): PaletteItem => ({
      id: `eq:${preset.id}`,
      group: "sound",
      label: t("command.equalizer", { name: preset.name }),
      ...(soundOff ? { subtitle: t("command.soundOff") } : {}),
      keywords: ["eq", "equalizer", "klang", "preset", preset.id],
      icon: "equalizer",
      active: preset.id === input.equalizerPresetId,
      disabled: soundOff,
      action: { kind: "equalizer", presetId: preset.id },
    })),
    ...SPATIAL_PRESETS.map((preset): PaletteItem => ({
      id: `room:${preset.presetId}`,
      group: "sound",
      label: t("command.room", { name: preset.name }),
      subtitle: soundOff ? t("command.soundOff") : preset.description,
      keywords: ["raum", "room", "hall", "space", "räumlich", preset.presetId],
      icon: "room",
      active: preset.presetId === input.roomPresetId,
      disabled: soundOff,
      action: { kind: "room", presetId: preset.presetId },
    })),
  ];

  const themes = THEME_COMMANDS.map((theme): PaletteItem => ({
    id: `theme:${theme.id}`,
    group: "appearance",
    label: t("command.theme", { name: t(theme.nameKey) }),
    keywords: ["theme", "design", "farbe", ...theme.keywords],
    icon: "theme",
    active: theme.id === input.theme,
    action: { kind: "theme", mode: theme.id },
  }));

  return [...commands, ...pages, ...sound, ...themes];
}

function command(
  id: string,
  label: string,
  icon: PaletteItem["icon"],
  keywords: string[],
  extra: Partial<Pick<PaletteItem, "hint" | "disabled" | "active">> = {},
): PaletteItem {
  return { id, group: "playback", label, icon, keywords, ...extra, action: { kind: "command", id } };
}

function repeatCommandLabel(mode: PlaybackState["repeatMode"]): string {
  if (mode === "off") return t("player.repeatAll");
  if (mode === "all") return t("player.repeatOne");
  return t("command.repeatStop");
}

/**
 * How well `query` names `item`, 0 when it does not. Label start beats a
 * word start beats a substring beats keywords; initials ("nt" → "Nächster
 * Titel") and letters in order count a little.
 */
export function matchScore(query: string, item: Pick<PaletteItem, "label" | "subtitle" | "keywords">): number {
  const needle = plain(query);
  if (!needle) return 1;
  const label = plain(item.label);
  if (label === needle) return 100;
  if (label.startsWith(needle)) return 80;
  const words = label.split(" ");
  if (words.some((word) => word.startsWith(needle))) return 65;
  if (label.includes(needle)) return 50;
  const parts = needle.split(" ").filter(Boolean);
  const haystack = [label, matchKey(item.subtitle ?? ""), ...item.keywords.map(matchKey)].join(" ");
  if (parts.every((part) => haystack.includes(part))) {
    return item.keywords.some((keyword) => matchKey(keyword).startsWith(needle)) ? 45 : 35;
  }
  const initials = words.map((word) => word[0]).join("");
  if (needle.length >= 2 && !needle.includes(" ") && initials.startsWith(needle)) return 30;
  if (needle.length >= 3 && inOrder(needle, label)) return 12;
  return 0;
}

/** Punctuation does not count: "theme hell" names "Theme: Hell". */
function plain(value: string): string {
  return matchKey(value.replace(/[:·,–—()„“”"'!?.-]+/g, " "));
}

function inOrder(needle: string, text: string): boolean {
  let at = 0;
  for (const character of needle) {
    at = text.indexOf(character, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

/** Commands, pages, sound and themes that match, best first; `boost` favours often-used ones. */
export function rankCommands(
  items: PaletteItem[],
  query: string,
  boost: (id: string) => number,
  limit = 8,
): Array<{ item: PaletteItem; score: number }> {
  return items
    .map((item) => ({ item, score: matchScore(query, item) }))
    .filter(({ score }) => score > 0)
    .map(({ item, score }) => ({ item, score: score + boost(item.id) - (item.disabled ? 20 : 0) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function searchFallback(query: string): PaletteItem {
  const trimmed = query.trim();
  return {
    id: "search",
    group: "search",
    label: trimmed ? t("command.searchFor", { query: trimmed }) : t("command.searchOpen"),
    keywords: [],
    icon: "search",
    ...(trimmed ? {} : { hint: "/" }),
    action: { kind: "search", query: trimmed },
  };
}

export function groupPaletteItems(items: PaletteItem[]): Array<{ group: PaletteGroup; items: PaletteItem[] }> {
  return GROUP_ORDER.flatMap((group) => {
    const grouped = items.filter((item) => item.group === group);
    return grouped.length > 0 ? [{ group, items: grouped }] : [];
  });
}

export function moveSelection(
  current: number,
  length: number,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End" | "PageDown" | "PageUp",
): number {
  if (length <= 0) return 0;
  const last = length - 1;
  const page = Math.min(8, Math.max(1, last));
  switch (key) {
    case "ArrowDown":
      return current >= last ? 0 : current + 1;
    case "ArrowUp":
      return current <= 0 ? last : current - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return Math.min(last, current + page);
    case "PageUp":
      return Math.max(0, current - page);
  }
}
