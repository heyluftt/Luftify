export const shellDe = {
  "shell.nowPlaying": "Läuft gerade",
  "shell.noTitle": "Kein Titel",
  "shell.unknownArtist": "Unbekannter Künstler",
  "shell.artist": "Künstler",
  "shell.coverOf": "Cover von {title}",
  "shell.loadMore": "Mehr laden",
  "shell.loadingMore": "Weitere Titel werden geladen …",
  "shell.window.minimize": "Fenster minimieren",
  "shell.window.maximize": "Fenster maximieren oder wiederherstellen",
  "shell.window.close": "Fenster schließen",
} as const;

export const shellEn: Record<keyof typeof shellDe, string> = {
  "shell.nowPlaying": "Now playing",
  "shell.noTitle": "No title",
  "shell.unknownArtist": "Unknown artist",
  "shell.artist": "Artist",
  "shell.coverOf": "Cover of {title}",
  "shell.loadMore": "Load more",
  "shell.loadingMore": "Loading more tracks …",
  "shell.window.minimize": "Minimize window",
  "shell.window.maximize": "Maximize or restore window",
  "shell.window.close": "Close window",
};
