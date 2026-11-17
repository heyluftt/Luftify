import type { CoverPalette } from "./coverPalette";

type Rgb = { r: number; g: number; b: number };

export interface PrismaSurfaces {
  ink: string;
  panel: string;
  raised: string;
  onAccent: string;
}

const DEFAULT_PRIMARY: Rgb = { r: 86, g: 142, b: 152 };
const DEFAULT_UI_PRIMARY: Rgb = { r: 126, g: 176, b: 186 };
const DARK_INK: Rgb = { r: 3, g: 4, b: 6 };
/** Strongest room dye; the panel stays a deep color, never a bright one. */
const ROOM_DYE_MAX = 0.085;
const LIGHT_INK: Rgb = { r: 255, g: 255, b: 255 };

/** Prisma does not display the synthetic hue split of a neutral cover. */
export function normalizePrismaPalette(palette: CoverPalette): CoverPalette {
  const vividness = Number.isFinite(palette.vividness) ? palette.vividness : 0.3;
  const colorWeight = clamp(vividness / 0.08, 0, 1);
  if (colorWeight === 1) return palette;

  const normalize = (value: string) => {
    const color = parseColor(value);
    if (!color) return value;
    const grey = luminance(color);
    // A luminance-matched grey in linear light keeps light fields and button
    // contrast stable while the cover's actual colorfulness controls the tint.
    const channel = (value: number) => encodeChannel(grey + (linearChannel(value) - grey) * colorWeight);
    return rgbCss({ r: channel(color.r), g: channel(color.g), b: channel(color.b) });
  };

  return {
    ...palette,
    primary: normalize(palette.primary),
    secondary: normalize(palette.secondary),
    highlight: normalize(palette.highlight),
    shadow: normalize(palette.shadow),
    uiPrimary: normalize(palette.uiPrimary),
    uiSecondary: normalize(palette.uiSecondary),
    pigments: palette.pigments.map(normalize),
  };
}

/** Prisma's accents are the cover's own leading colors, bright enough for labels. */
export function intensifyPrismaPalette(palette: CoverPalette): CoverPalette {
  const [first, second] = palette.pigments.map(parseColor).filter((color): color is Rgb => color !== null);
  if (!first) return palette;
  return {
    ...palette,
    uiPrimary: rgbCss(accentFrom(first)),
    uiSecondary: rgbCss(accentFrom(second ?? first)),
  };
}

/** Four lights for the scene; neutral covers fall back to their quiet tints. */
export function prismaPigments(palette: CoverPalette): [string, string, string, string] {
  const own = palette.pigments;
  if (!own.length) return [palette.uiPrimary, palette.uiSecondary, palette.highlight, palette.primary];
  return [0, 1, 2, 3].map((index) => own[index % own.length]!) as [string, string, string, string];
}

/**
 * The room is dyed deep in the cover's leading color; lightness stays low, so
 * reading text keeps its contrast. Neutral covers stay graphite.
 */
export function prismaSurfacesFromPalette(palette: CoverPalette): PrismaSurfaces {
  const primary = parseColor(palette.primary) ?? DEFAULT_PRIMARY;
  const uiPrimary = parseColor(palette.uiPrimary) ?? DEFAULT_UI_PRIMARY;
  const vividness = Number.isFinite(palette.vividness) ? clamp(palette.vividness, 0, 1) : 0.3;
  const pigments = palette.pigments.map(parseColor).filter((color): color is Rgb => color !== null);
  const lead = pigments[0];
  const { hue, strength } = roomHue(hueOf(lead ?? primary));
  // Neutral covers already contain a small synthetic tint in the extracted
  // palette. Their measured vividness keeps that tint out of reading surfaces.
  const coverChroma = lead ? vividness : Math.min(chromaOf(primary), vividness);
  const dye = Math.min(ROOM_DYE_MAX, coverChroma * 0.24) * strength;

  return {
    ink: rgbCss(tintedGraphite(hue, 0.034, dye * 0.55)),
    panel: rgbCss(tintedGraphite(hue, 0.074, dye)),
    raised: rgbCss(tintedGraphite(hue, 0.11, dye * 1.22)),
    onAccent: rgbCss(contrastRatio(uiPrimary, DARK_INK) >= contrastRatio(uiPrimary, LIGHT_INK)
      ? DARK_INK
      : LIGHT_INK),
  };
}

/** Dark orange, yellow and yellow-green read as brown and olive. */
function isDarkMuddyHue(hue: number): boolean {
  return hue > 12 && hue < 84;
}

/** Such rooms lean to red and take a little less color. */
function roomHue(hue: number): { hue: number; strength: number } {
  if (!isDarkMuddyHue(hue)) return { hue, strength: 1 };
  return { hue: 6 + (hue - 12) * 0.2, strength: hue < 40 ? 0.85 : 0.6 };
}

function accentFrom(color: Rgb): Rgb {
  const lightness = 0.64;
  const room = 1 - Math.abs(2 * lightness - 1);
  return tintedGraphite(hueOf(color), lightness, Math.min(chromaOf(color) * 1.08, room * 0.96));
}

/** A color from hue, lightness and chroma (HSL lightness, RGB chroma). */
function tintedGraphite(hue: number, lightness: number, chroma: number): Rgb {
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [r, g, b] = section < 1 ? [chroma, x, 0]
    : section < 2 ? [x, chroma, 0]
      : section < 3 ? [0, chroma, x]
        : section < 4 ? [0, x, chroma]
          : section < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const base = lightness - chroma / 2;
  return { r: (r + base) * 255, g: (g + base) * 255, b: (b + base) * 255 };
}

function hueOf({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (!delta) return 0;
  const section = max === r ? ((g - b) / delta) % 6
    : max === g ? (b - r) / delta + 2
      : (r - g) / delta + 4;
  return (section * 60 + 360) % 360;
}

function chromaOf({ r, g, b }: Rgb): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function luminance({ r, g, b }: Rgb): number {
  return linearChannel(r) * 0.2126 + linearChannel(g) * 0.7152 + linearChannel(b) * 0.0722;
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encodeChannel(value: number): number {
  return (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055) * 255;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function parseColor(value: string): Rgb | null {
  const rgb = value.match(/^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i);
  if (rgb) return { r: clamp(Number(rgb[1]), 0, 255), g: clamp(Number(rgb[2]), 0, 255), b: clamp(Number(rgb[3]), 0, 255) };
  const hex = value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  return hex ? { r: parseInt(hex[1]!, 16), g: parseInt(hex[2]!, 16), b: parseInt(hex[3]!, 16) } : null;
}

function rgbCss({ r, g, b }: Rgb): string {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
