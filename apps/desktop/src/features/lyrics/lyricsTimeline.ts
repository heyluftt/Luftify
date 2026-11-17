import type { LyricsLine } from "../../types/tauri";

export function activeLyricIndex(
  lines: LyricsLine[],
  positionMs: number,
): number {
  let active = -1;

  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    const start = lines[index]?.startMs;

    if (start === null || start === undefined) {
      continue;
    }

    if (start > positionMs + 80) {
      break;
    }

    active = index;
  }

  return active;
}

export function lyricLineClassName(
  index: number,
  activeIndex: number,
): string {
  if (activeIndex < 0) {
    if (index === 0) {
      return "future near upcoming";
    }

    return index === 1
      ? "future mid"
      : "future far";
  }

  const distance = index - activeIndex;

  if (distance === 0) {
    return "active";
  }

  const proximity =
    Math.abs(distance) === 1
      ? "near"
      : Math.abs(distance) === 2
        ? "mid"
        : "far";

  return `${distance < 0 ? "past" : "future"} ${proximity}`;
}

export function isLyricsInterlude(text: string): boolean {
  const value = text.trim();
  return value.length > 0 && /^[♪♫♬♩\s]+$/u.test(value);
}
