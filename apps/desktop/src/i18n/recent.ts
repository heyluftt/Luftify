export const recentDe = {
  "recent.title": "Zuletzt gehört",
  "recent.close": "Zuletzt gehört schließen",
  "recent.today": "Heute",
  "recent.yesterday": "Gestern",
  "recent.plays": "{count}×",
  "recent.playsHint": "{count}-mal gehört",
  "recent.more": "Weitere Aktionen für {title}",
  "recent.loading": "Hörverlauf wird geladen …",
  "recent.error": "Der Hörverlauf konnte nicht geladen werden.",
  "recent.empty": "Noch keine Songs im lokalen Hörverlauf. Höre mit aktivierter Höranalyse etwas Musik, dann erscheinen deine Titel hier.",
  "recent.disabled": "Die Höranalyse ist deaktiviert. Vorhandene Einträge bleiben sichtbar, neue werden nicht erfasst. Den Verlauf kannst du unter Daten & Cache löschen.",
} as const;

export const recentEn: Record<keyof typeof recentDe, string> = {
  "recent.title": "Recently played",
  "recent.close": "Close recently played",
  "recent.today": "Today",
  "recent.yesterday": "Yesterday",
  "recent.plays": "{count}×",
  "recent.playsHint": "Played {count} times",
  "recent.more": "More actions for {title}",
  "recent.loading": "Loading listening history …",
  "recent.error": "Listening history could not be loaded.",
  "recent.empty": "No songs in your local history yet. Listen with listening analytics enabled to see your tracks here.",
  "recent.disabled": "Listening analytics are disabled. Existing entries remain visible; new listens are not recorded. Clear history under Data & cache in Settings.",
};
