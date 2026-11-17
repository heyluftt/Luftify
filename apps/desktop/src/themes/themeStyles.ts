import type { ThemeMode } from "./theme";

/**
 * One stylesheet per theme, loaded when the theme is first used. Before,
 * all ten themes (~half of the app's CSS) were parsed at every start
 * although only one can be active.
 */
const STYLES: Record<ThemeMode, () => Promise<unknown>> = {
  dark: () => import("../styles/theme-bundles/dark.css"),
  light: () => import("../styles/theme-bundles/light.css"),
  atelier: () => import("../styles/theme-bundles/atelier.css"),
  luft: () => import("../styles/theme-bundles/luft.css"),
  redline: () => import("../styles/theme-bundles/redline.css"),
  rose: () => import("../styles/theme-bundles/rose.css"),
  polaris: () => import("../styles/theme-bundles/polaris.css"),
  prisma: () => import("../styles/theme-bundles/prisma.css"),
  calamus: () => import("../styles/theme-bundles/calamus.css"),
  abyss: () => import("../styles/theme-bundles/abyss.css"),
  aeris: () => import("../styles/theme-bundles/aeris.css"),
};

const loaded = new Set<ThemeMode>();
const loading = new Map<ThemeMode, Promise<void>>();

/**
 * Nothing when the theme's styles are in the page, otherwise a promise that
 * settles once they are (also on failure: the theme then applies with the
 * shared styles rather than not at all).
 */
export function loadThemeStyles(mode: ThemeMode): Promise<void> | undefined {
  if (loaded.has(mode)) return undefined;
  let pending = loading.get(mode);
  if (!pending) {
    pending = STYLES[mode]()
      .catch(() => undefined)
      .then(() => {
        loaded.add(mode);
        loading.delete(mode);
      });
    loading.set(mode, pending);
  }
  return pending;
}
