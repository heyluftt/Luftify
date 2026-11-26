import type { ThemeManifest } from "./theme";

/** A modular synthesizer: anodised black, silk-screen white, a green LED. */
export const modularTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.modular",
  name: "Modular",
  version: "1.0.0",
  colors: {
    background: "#0B0C0E",
    surface: "#141518",
    surfaceElevated: "#1E2024",
    primary: "#45D483",
    textPrimary: "#E9E8E1",
    textMuted: "#8F9298",
  },
  metrics: { cornerRadius: 3, spacingScale: 1, blur: 0 },
  motion: { durationScale: 0.8 },
};
