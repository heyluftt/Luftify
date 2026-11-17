import { appLanguage } from "../../i18n";
import bundledDe from "../../../release-notes.md?raw";
import bundledEn from "../../../release-notes.en.md?raw";

const HEADING = /^#\s*v?(\d+\.\d+\.\d+)/m;

/** One point per line; headings and Markdown bullets are dropped. */
export function noteLines(text: string | null | undefined): string[] {
  return (text ?? "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*•]\s*/, ""))
    .filter(Boolean);
}

/** The newest version's heading and its points; older sections below stay out. */
export function newestSection(text: string): { version: string | null; lines: string[] } {
  const version = HEADING.exec(text)?.[1] ?? null;
  const start = text.search(HEADING);
  const rest = start < 0 ? text : text.slice(start).replace(HEADING, "");
  const next = rest.search(/^#\s*v?\d+\.\d+\.\d+/m);
  return { version, lines: noteLines(next < 0 ? rest : rest.slice(0, next)) };
}

/** Notes in the app's language: English when there are English ones for the same version. */
export function pickNotes(de: string | null | undefined, en: string | null | undefined): string[] {
  return noteLines(appLanguage() === "en" && en?.trim() ? en : de);
}

const german = newestSection(bundledDe);
const english = newestSection(bundledEn);

/**
 * The notes this build ships with (`apps/desktop/release-notes.md` and
 * `release-notes.en.md`). The publish script only builds when both headings
 * name the version it publishes.
 */
export const BUNDLED_NOTES = {
  version: german.version,
  lines: appLanguage() === "en" && english.version === german.version && english.lines.length ? english.lines : german.lines,
};

/** Every version in the file, newest first. */
export function allSections(text: string): { version: string; lines: string[] }[] {
  return text.split(/^(?=#\s*v?\d+\.\d+\.\d+)/m)
    .map((part) => ({ version: HEADING.exec(part)?.[1], lines: noteLines(part) }))
    .filter((section): section is { version: string; lines: string[] } => Boolean(section.version) && section.lines.length > 0);
}

/** The version history this build ships with, English where a version has English notes. */
export function releaseHistory(): { version: string; lines: string[] }[] {
  const english = new Map(allSections(bundledEn).map((section) => [section.version, section.lines]));
  return allSections(bundledDe).map((section) => ({
    version: section.version,
    lines: appLanguage() === "en" ? english.get(section.version) ?? section.lines : section.lines,
  }));
}
