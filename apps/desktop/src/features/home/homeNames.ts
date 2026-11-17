export function normalizePlaylistName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de-DE").trim();
}

export function isWeeklyMix(playlist: Pick<{ name: string }, "name">): boolean {
  const name = normalizePlaylistName(playlist.name);
  return name.includes("mix der woche") || name.includes("discover weekly");
}

export function isReleaseRadar(playlist: Pick<{ name: string }, "name">): boolean {
  return normalizePlaylistName(playlist.name).includes("release radar");
}

export function isDailyMix(playlist: Pick<{ name: string }, "name">): boolean {
  const name = normalizePlaylistName(playlist.name);
  if (isWeeklyMix(playlist)) return false;
  return name.includes("daily mix") || /^dein mix(?: |$)/.test(name);
}

export function isOnRepeat(playlist: Pick<{ name: string }, "name">): boolean {
  const name = normalizePlaylistName(playlist.name);
  return name.includes("on repeat")
    || name.includes("repeat rewind")
    || name.includes("wiederholung");
}

export function isDaylist(playlist: Pick<{ name: string }, "name">): boolean {
  return normalizePlaylistName(playlist.name).includes("daylist");
}

export function isTimeCapsule(playlist: Pick<{ name: string }, "name">): boolean {
  const name = normalizePlaylistName(playlist.name);
  return name.includes("time capsule") || name.includes("zeitkapsel");
}

export function personalizedScore(playlist: Pick<{ name: string }, "name">): number {
  if (isWeeklyMix(playlist)) return 100;
  if (isReleaseRadar(playlist)) return 90;
  if (isDailyMix(playlist) || isDaylist(playlist)) return 80;
  if (isOnRepeat(playlist) || isTimeCapsule(playlist)) return 70;
  return 0;
}
