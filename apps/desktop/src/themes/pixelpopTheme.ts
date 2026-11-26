import type { ThemeManifest } from "./theme";

/** A console that never existed: night blue, cream and a coral cursor. */
export const pixelpopTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.pixelpop",
  name: "Pixelpop",
  version: "1.0.0",
  colors: {
    background: "#0D0B1C",
    surface: "#16142A",
    surfaceElevated: "#262245",
    primary: "#FF6B5B",
    textPrimary: "#F6EEDB",
    textMuted: "#A7A1C8",
  },
  metrics: { cornerRadius: 4, spacingScale: 1, blur: 0 },
  motion: { durationScale: 0.75 },
};
