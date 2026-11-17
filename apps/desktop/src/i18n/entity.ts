export const entityDe = {
  "entity.playName": "{name} abspielen",
  "entity.album": "Album",
  "entity.artist": "Künstler",
  "entity.albumEmpty": "Für dieses Album wurden keine Titel geliefert.",
} as const;

export const entityEn: Record<keyof typeof entityDe, string> = {
  "entity.playName": "Play {name}",
  "entity.album": "Album",
  "entity.artist": "Artist",
  "entity.albumEmpty": "No tracks were delivered for this album.",
};
