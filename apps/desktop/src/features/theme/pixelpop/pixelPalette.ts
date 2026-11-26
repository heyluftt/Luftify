import { pixelpopTheme } from "../../../themes/pixelpopTheme";

export interface PixelPalette {
  deep: string;
  ink: string;
  panel: string;
  panel2: string;
  line: string;
  cream: string;
  mute: string;
  coral: string;
  sun: string;
  plum: string;
}

const { colors } = pixelpopTheme;
const FALLBACK: PixelPalette = {
  deep: colors.background, ink: colors.surface, panel: "#221f3d", panel2: "#2f2b52", line: "#47407a",
  cream: colors.textPrimary, mute: colors.textMuted, coral: colors.primary,
  sun: "#ffc94a", plum: "#b65fcf",
};

const TOKENS: Record<keyof PixelPalette, string> = {
  deep: "--pp-deep", ink: "--pp-ink", panel: "--pp-panel", panel2: "--pp-panel-2", line: "--pp-line",
  cream: "--pp-cream", mute: "--pp-mute", coral: "--pp-coral", sun: "--pp-sun",
  plum: "--pp-plum",
};

/** The theme's colours for canvas drawing, from its tokens once they are loaded. */
export function readPixelPalette(from: Element = document.documentElement): PixelPalette {
  const style = getComputedStyle(from);
  const palette = { ...FALLBACK };
  for (const key of Object.keys(TOKENS) as Array<keyof PixelPalette>) {
    const value = style.getPropertyValue(TOKENS[key]).trim();
    if (value) palette[key] = value;
  }
  return palette;
}
