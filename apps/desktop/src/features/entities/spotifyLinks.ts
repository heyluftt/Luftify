export function spotifyOpenUrl(uri: string | undefined): string | undefined {
  const match = /^(spotify):(track|album|artist|playlist):([A-Za-z0-9]+)$/.exec(
    uri?.trim() ?? "",
  );
  if (!match) return undefined;
  return `https://open.spotify.com/${match[2]}/${match[3]}`;
}

export function formatTrackDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function shareCopy(track: {
  title: string;
  creators: Array<{ name: string }>;
}): string {
  const artists = track.creators
    .map((creator) => creator.name.trim())
    .filter(Boolean)
    .join(", ");
  return artists ? `${track.title} · ${artists}` : track.title;
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(value);
    return;
  }

  throw new Error("Zwischenablage nicht verfügbar.");
}

export function openExternalUrl(url: string): void {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    throw new Error("Der Browser konnte nicht geöffnet werden.");
  }
}
