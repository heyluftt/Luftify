export const librarySetupDe = {
  "setup.title": "Luftify richtet sich ein",
  "setup.subtitle": "Warte kurz, während Luftify deine Musik vorbereitet. Danach läuft alles viel flüssiger.",
  "setup.library": "Bibliothek und Lieblingssongs werden geladen …",
  "setup.playlist": "Playlist {done} von {total}",
  "setup.skip": "Überspringen",
  "setup.skipSure": "Wirklich überspringen? Am Anfang läuft Luftify dann langsamer.",
  "setup.skipReallySure": "Ganz sicher? Das Einrichten läuft dann leise im Hintergrund weiter.",
  "setup.skipYes": "Ja, überspringen",
  "setup.skipReallyYes": "Ganz sicher",
  "setup.keepWaiting": "Weiter warten",
} as const;

export const librarySetupEn: { [K in keyof typeof librarySetupDe]: string } = {
  "setup.title": "Luftify is setting up",
  "setup.subtitle": "Hang on while Luftify prepares your music. Everything runs much smoother afterwards.",
  "setup.library": "Loading your library and liked songs …",
  "setup.playlist": "Playlist {done} of {total}",
  "setup.skip": "Skip",
  "setup.skipSure": "Skip for real? Luftify will be slower at first.",
  "setup.skipReallySure": "Absolutely sure? Setting up then continues quietly in the background.",
  "setup.skipYes": "Yes, skip",
  "setup.skipReallyYes": "Absolutely sure",
  "setup.keepWaiting": "Keep waiting",
};
