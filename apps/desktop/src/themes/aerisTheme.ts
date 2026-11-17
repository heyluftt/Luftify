import type { ThemeManifest } from "./theme";

/** Storm silver and smoked blue: low-luminance surfaces, sculpted light edges. */
export const aerisTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.aeris",
  name: "Aeris",
  version: "1.0.0",
  colors: {
    background: "#56697E",
    surface: "#8798AA",
    surfaceElevated: "#9BAABA",
    primary: "#1F3A56",
    textPrimary: "#07111B",
    textMuted: "#1B2E41",
  },
  metrics: { cornerRadius: 18, spacingScale: 1, blur: 0 },
  motion: { durationScale: 1.1 },
};
