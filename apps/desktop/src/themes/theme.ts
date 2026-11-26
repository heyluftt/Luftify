import { z } from "zod";
import { loadThemeStyles } from "./themeStyles";
import { aerisTheme } from "./aerisTheme";
import { pixelpopTheme } from "./pixelpopTheme";
import { modularTheme } from "./modularTheme";
export { aerisTheme } from "./aerisTheme";
export { pixelpopTheme } from "./pixelpopTheme";
export { modularTheme } from "./modularTheme";

const color = z.string().regex(/^#[\da-f]{6}$/i);

export const themeSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  version: z.string().min(1).max(20),

  colors: z.object({
    background: color,
    surface: color,
    surfaceElevated: color,
    primary: color,
    textPrimary: color,
    textMuted: color,
  }),

  metrics: z.object({
    cornerRadius: z.number().min(0).max(32),
    spacingScale: z.number().min(0.75).max(1.5),
    blur: z.number().min(0).max(30),
  }),

  motion: z.object({
    durationScale: z.number().min(0).max(2),
  }),
});

export type ThemeManifest = z.infer<typeof themeSchema>;

export const themeModes = [
  "light",
  "atelier",
  "dark",
  "luft",
  "redline",
  "rose",
  "polaris",
  "prisma",
  "calamus",
  "abyss",
  "aeris",
  "pixelpop",
  "modular",
] as const;

export type ThemeMode = (typeof themeModes)[number];

const THEME_STORAGE_KEY = "luft.theme.mode";

const themeModeAliases: Record<string, ThemeMode> = {
  "luft.light": "light",
  "luft.atelier": "atelier",
  "luft.dark": "dark",
  "luft.violet": "luft",
  "luft.redline": "redline",
  // Bernstein was removed; its users move to Luft Dark.
  bernstein: "dark",
  "luft.bernstein": "dark",
  "luft.abyss": "abyss",
  "luft.aeris": "aeris",
  "luft.pixelpop": "pixelpop",
  "luft.modular": "modular",
  "luft.rose": "rose",
  "luft.polaris": "polaris",
  "luft.prisma": "prisma",
  "luft.calamus": "calamus",
  kladde: "calamus",
  "luft.kladde": "calamus",
};

export const darkTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.dark",
  name: "Luft Dark",
  version: "1.2.0",

  colors: {
    background: "#020304",
    surface: "#080A0C",
    surfaceElevated: "#101316",
    primary: "#BCC7D4",
    textPrimary: "#E8EBEF",
    textMuted: "#A0A7B0",
  },

  metrics: {
    cornerRadius: 14,
    spacingScale: 1,
    blur: 18,
  },

  motion: {
    durationScale: 1,
  },
};

export const lightTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.light",
  name: "Luft Light",
  version: "1.1.0",

  colors: {
    background: "#ECEDEA",
    surface: "#FAFAF7",
    surfaceElevated: "#FFFFFF",
    primary: "#5062BE",
    textPrimary: "#202329",
    textMuted: "#686F79",
  },

  metrics: {
    cornerRadius: 14,
    spacingScale: 1,
    blur: 14,
  },

  motion: {
    durationScale: 1,
  },
};

export const atelierTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.atelier",
  name: "Atelier",
  version: "1.2.0",

  colors: {
    background: "#EFE9DD",
    surface: "#FFFCF5",
    surfaceElevated: "#E7E0D2",
    primary: "#145F57",
    textPrimary: "#29251E",
    textMuted: "#6B6458",
  },

  metrics: {
    cornerRadius: 9,
    spacingScale: 1,
    blur: 5,
  },

  motion: {
    durationScale: 0.95,
  },
};

export const luftTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.violet",
  name: "Luft Violet",
  version: "2.0.0",

  colors: {
    background: "#06040F",
    surface: "#0D0A1C",
    surfaceElevated: "#1A1532",
    primary: "#A796FF",
    textPrimary: "#F4F1FF",
    textMuted: "#A39DBE",
  },

  metrics: {
    cornerRadius: 16,
    spacingScale: 1,
    blur: 18,
  },

  motion: {
    durationScale: 1,
  },
};

export const redlineTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.redline",
  name: "Redline",
  version: "1.2.0",

  colors: {
    background: "#080809",
    surface: "#111214",
    surfaceElevated: "#1A1C1F",
    primary: "#E13D41",
    textPrimary: "#F2F2F3",
    textMuted: "#A2A4AA",
  },

  metrics: {
    cornerRadius: 9,
    spacingScale: 1,
    blur: 8,
  },

  motion: {
    durationScale: 0.9,
  },
};

export const roseTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.rose",
  name: "Rosé Nocturne",
  version: "1.3.0",

  colors: {
    background: "#0E070C",
    surface: "#1A1016",
    surfaceElevated: "#2B1B24",
    primary: "#E3A3B8",
    textPrimary: "#F7EEF2",
    textMuted: "#B197A3",
  },

  metrics: {
    cornerRadius: 18,
    spacingScale: 1,
    blur: 22,
  },

  motion: {
    durationScale: 1.08,
  },
};

export const polarisTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.polaris",
  name: "Polaris",
  version: "2.0.0",

  colors: {
    background: "#04070F",
    surface: "#070C18",
    surfaceElevated: "#101A2D",
    primary: "#9CCBFF",
    textPrimary: "#EEF3FB",
    textMuted: "#8C98AE",
  },

  metrics: {
    cornerRadius: 12,
    spacingScale: 1,
    blur: 22,
  },

  motion: {
    durationScale: 1.05,
  },
};

export const prismaTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.prisma",
  name: "Prisma",
  version: "3.0.0",

  colors: {
    background: "#0A0C10",
    surface: "#13161B",
    surfaceElevated: "#20252B",
    primary: "#7EAEB8",
    textPrimary: "#F3F1EE",
    textMuted: "#A4A8B2",
  },

  metrics: {
    cornerRadius: 12,
    spacingScale: 1,
    blur: 6,
  },

  motion: {
    durationScale: 1,
  },
};

export const calamusTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.calamus",
  name: "Calamus",
  version: "1.0.0",

  colors: {
    background: "#0F0E0D",
    surface: "#171614",
    surfaceElevated: "#211F1C",
    primary: "#6A8FEA",
    textPrimary: "#EEE9DF",
    textMuted: "#948D80",
  },

  metrics: {
    cornerRadius: 3,
    spacingScale: 1,
    blur: 0,
  },

  motion: {
    durationScale: 0.45,
  },
};

export const abyssTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "luft.abyss",
  name: "Tiefsee",
  version: "1.0.0",

  colors: {
    background: "#02080C",
    surface: "#061219",
    surfaceElevated: "#0B1E27",
    primary: "#5CE8DA",
    textPrimary: "#E4F6F4",
    textMuted: "#7EA2A6",
  },

  metrics: {
    cornerRadius: 16,
    spacingScale: 1,
    blur: 20,
  },

  motion: {
    durationScale: 1.1,
  },
};

export const registeredThemes = {
  light: lightTheme,
  atelier: atelierTheme,
  dark: darkTheme,
  luft: luftTheme,
  redline: redlineTheme,
  rose: roseTheme,
  polaris: polarisTheme,
  prisma: prismaTheme,
  calamus: calamusTheme,
  abyss: abyssTheme,
  aeris: aerisTheme,
  pixelpop: pixelpopTheme,
  modular: modularTheme,
} as const;

export function normalizeThemeMode(mode: string): ThemeMode {
  const normalized = mode.trim().toLowerCase();
  if (themeModes.includes(normalized as ThemeMode)) return normalized as ThemeMode;
  return themeModeAliases[normalized] ?? "dark";
}

export function readRememberedThemeMode(): ThemeMode | undefined {
  try {
    const mode = localStorage.getItem(THEME_STORAGE_KEY);
    return mode ? normalizeThemeMode(mode) : undefined;
  } catch {
    return undefined;
  }
}

export function rememberThemeMode(mode: string): ThemeMode {
  const normalized = normalizeThemeMode(mode);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalized);
  } catch {
    // The database remains the durable source when web storage is unavailable.
  }
  return normalized;
}

let themeRequest = 0;

/**
 * Switches once the theme's stylesheet is in the page, so a switch never
 * shows the new colours without the new styles. The latest request wins.
 */
export function applyThemeMode(mode: string): Promise<void> {
  const normalized = normalizeThemeMode(mode);
  const request = ++themeRequest;
  const apply = () => {
    if (request === themeRequest) applyThemeManifest(normalized);
  };
  const pending = loadThemeStyles(normalized);
  if (!pending) {
    apply();
    return Promise.resolve();
  }
  return pending.then(apply);
}

function applyThemeManifest(mode: ThemeMode): void {
  switch (mode) {
    case "light":
      applyTheme(lightTheme);
      return;
    case "atelier":
      applyTheme(atelierTheme);
      return;
    case "dark":
      applyTheme(darkTheme);
      return;
    case "luft":
      applyTheme(luftTheme);
      return;
    case "redline":
      applyTheme(redlineTheme);
      return;
    case "rose":
      applyTheme(roseTheme);
      return;
    case "polaris":
      applyTheme(polarisTheme);
      return;
    case "prisma":
      applyTheme(prismaTheme);
      return;
    case "calamus":
      applyTheme(calamusTheme);
      return;
    case "abyss":
      applyTheme(abyssTheme);
      return;
    case "aeris":
      applyTheme(aerisTheme);
      return;
    case "pixelpop":
      applyTheme(pixelpopTheme);
      return;
    case "modular":
      applyTheme(modularTheme);
  }
}

export function applyTheme(theme: ThemeManifest): void {
  const root = document.documentElement;
  const parsedTheme = themeSchema.parse(theme);
  const { colors, metrics, motion } = parsedTheme;

  // Keep Prisma linked to the live palette even when settings reapply the
  // same theme without a track change. Other themes use their fixed colors.
  const prisma = parsedTheme.id === prismaTheme.id;
  root.style.setProperty("--color-bg", prisma ? `var(--prisma-ink, ${colors.background})` : colors.background);
  root.style.setProperty("--color-surface", prisma ? `var(--prisma-panel, ${colors.surface})` : colors.surface);
  root.style.setProperty(
    "--color-surface-elevated",
    prisma ? `var(--prisma-raised, ${colors.surfaceElevated})` : colors.surfaceElevated,
  );
  root.style.setProperty("--color-primary", prisma ? `var(--prisma-ui-primary, ${colors.primary})` : colors.primary);
  root.style.setProperty("--color-text", colors.textPrimary);
  root.style.setProperty("--color-muted", colors.textMuted);
  root.style.setProperty(
    "--radius",
    `${metrics.cornerRadius}px`,
  );
  root.style.setProperty("--blur", `${metrics.blur}px`);
  root.style.setProperty(
    "--space-scale",
    String(metrics.spacingScale),
  );
  // The theme's own tempo; --motion-scale (styles/motion/levels.css) builds
  // on it, so the "Animationen" setting and Windows can still slow it to 0.
  root.style.setProperty(
    "--theme-motion-scale",
    String(motion.durationScale),
  );

  root.dataset.theme = parsedTheme.id;
}
