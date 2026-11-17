import { describe, expect, it } from "vitest";
import {
  DEFAULT_COVER_PALETTE,
  createCoverPaletteFromImageData,
  prismaSurfacesFromPalette,
} from "../src/features/theme/coverPalette";

describe("Prisma cover palette", () => {
  it("keeps reading surfaces dark and separates their depth across cover hues", () => {
    for (const color of [[240, 240, 240], [220, 32, 46], [25, 195, 92], [98, 46, 176]] as const) {
      const palette = createCoverPaletteFromImageData(solidImage([...color]));
      const surfaces = prismaSurfacesFromPalette(palette);
      const ink = hslFromCss(surfaces.ink).l;
      const panel = hslFromCss(surfaces.panel).l;
      const raised = hslFromCss(surfaces.raised).l;
      expect(panel).toBeGreaterThan(ink);
      expect(raised).toBeGreaterThan(panel);
      expect(raised).toBeLessThan(0.18);
    }
  });

  it("keeps strongly different cover hues distinct", () => {
    const red = createCoverPaletteFromImageData(solidImage([220, 32, 46]));
    const green = createCoverPaletteFromImageData(solidImage([25, 195, 92]));

    expect(red.primary).not.toBe(green.primary);
    expect(red.uiPrimary).not.toBe(green.uiPrimary);
  });

  it("uses the location of a cover accent to steer the composition", () => {
    const leftAccent = createCoverPaletteFromImageData(accentImage(0));
    const rightAccent = createCoverPaletteFromImageData(accentImage(9));

    expect(leftAccent.focusX).toBeLessThan(rightAccent.focusX);
    expect(Math.abs(rightAccent.focusX - leftAccent.focusX)).toBeGreaterThan(5);
  });

  it("does not force neutral covers into the idle palette", () => {
    const neutral = createCoverPaletteFromImageData(solidImage([108, 108, 108]));

    expect(neutral.primary).not.toBe(DEFAULT_COVER_PALETTE.primary);
    expect(neutral.secondary).not.toBe(DEFAULT_COVER_PALETTE.secondary);
    expect(neutral.energy).toBeLessThan(DEFAULT_COVER_PALETTE.energy);
  });

  it("gives neutral covers stable but varied Prisma color splits", () => {
    const image = solidImage([108, 108, 108]);
    const palettes = Array.from({ length: 10 }, (_, index) =>
      createCoverPaletteFromImageData(image, `spotify:neutral-cover:${index}`));
    const first = palettes[0]!;

    expect(new Set(palettes.map((palette) => palette.primary)).size).toBeGreaterThan(5);
    expect(hueGap(hslFromCss(first.primary).h, hslFromCss(first.secondary).h)).toBeGreaterThan(20);
  });

  it("keeps a dark cover with red accents from dyeing the room brown", () => {
    const palette = createCoverPaletteFromImageData(darkRedCover());
    const surfaces = prismaSurfacesFromPalette(palette);
    const panel = hslFromCss(surfaces.panel);
    const raised = hslFromCss(surfaces.raised);
    const atmosphere = hslFromCss(palette.primary);
    const ui = hslFromCss(palette.uiPrimary);

    expect(panel.l).toBeLessThan(0.16);
    expect(raised.l).toBeLessThan(0.2);
    expect(isMuddyBrown(panel)).toBe(false);
    expect(isMuddyBrown(raised)).toBe(false);
    expect(atmosphere.l).toBeLessThan(0.34);
    expect(isRedHue(ui.h)).toBe(true);
    expect(ui.l).toBeGreaterThan(0.46);
  });

  it("keeps a near-black navy cover muted instead of turning it vivid blue", () => {
    // Night sky, black trees, a small moon: dark colors with little chroma.
    const pixels = Array.from({ length: 20 }, (_, index) =>
      index < 11 ? [14, 18, 30] as const
        : index < 17 ? [7, 8, 9] as const
          : index < 19 ? [30, 36, 52] as const
            : [225, 215, 185] as const);
    const palette = createCoverPaletteFromImageData(imageData(pixels, 5));
    const surfaces = prismaSurfacesFromPalette(palette);

    expect(chroma(palette.uiPrimary)).toBeLessThan(0.14);
    expect(chroma(palette.primary)).toBeLessThan(0.12);
    expect(chroma(surfaces.panel)).toBeLessThan(0.04);
  });

  it("gives Prisma each main color of a multicolored cover, and warm neighbors to a gold one", () => {
    const pixels = Array.from({ length: 16 }, (_, index) =>
      index < 6 ? [0, 214, 240] as const : index < 11 ? [240, 40, 170] as const : [12, 16, 44] as const);
    const neon = createCoverPaletteFromImageData(imageData(pixels, 4));
    const strong = (target: number) => neon.pigments.find((pigment) => hueGap(hslFromCss(pigment).h, target) < 20);
    expect(chroma(strong(188) ?? "rgb(0 0 0)")).toBeGreaterThan(0.5);
    expect(chroma(strong(318) ?? "rgb(0 0 0)")).toBeGreaterThan(0.5);

    const gold = createCoverPaletteFromImageData(solidImage([214, 160, 30]));
    expect(gold.pigments).toHaveLength(3);
    for (const pigment of gold.pigments) {
      const hue = hslFromCss(pigment).h;
      expect(hue <= 52 || hue >= 300).toBe(true);
    }
  });

  it("lets different cover hues dye the room differently", () => {
    const red = createCoverPaletteFromImageData(solidImage([188, 26, 34]));
    const teal = createCoverPaletteFromImageData(solidImage([16, 148, 158]));
    const violet = createCoverPaletteFromImageData(solidImage([98, 46, 176]));
    const redPanel = hslFromCss(prismaSurfacesFromPalette(red).panel);
    const tealPanel = hslFromCss(prismaSurfacesFromPalette(teal).panel);
    const violetPanel = hslFromCss(prismaSurfacesFromPalette(violet).panel);

    expect(hueGap(redPanel.h, tealPanel.h)).toBeGreaterThan(50);
    expect(hueGap(tealPanel.h, violetPanel.h)).toBeGreaterThan(40);
    expect(hueGap(hslFromCss(red.uiPrimary).h, hslFromCss(teal.uiPrimary).h)).toBeGreaterThan(50);
    expect(hueGap(hslFromCss(red.primary).h, hslFromCss(violet.primary).h)).toBeGreaterThan(40);
  });
});

function solidImage([r, g, b]: [number, number, number]): ImageData {
  return imageData(Array.from({ length: 16 }, () => [r, g, b] as const), 4);
}

function accentImage(accentIndex: number): ImageData {
  const pixels = Array.from({ length: 10 }, (_, index) =>
    index === accentIndex ? [232, 38, 54] as const : [112, 112, 112] as const);
  return imageData(pixels, 10);
}

function darkRedCover(): ImageData {
  const pixels = Array.from({ length: 16 }, (_, index) =>
    index < 13 ? [14, 12, 13] as const : [198, 22, 28] as const);
  return imageData(pixels, 4);
}

function hslFromCss(value: string): { h: number; s: number; l: number } {
  const match = value.match(/rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/i);
  if (!match) throw new Error(`expected rgb() color, got ${value}`);
  const red = Number(match[1]) / 255;
  const green = Number(match[2]) / 255;
  const blue = Number(match[3]) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = max === red
    ? 60 * (((green - blue) / delta) % 6)
    : max === green
      ? 60 * ((blue - red) / delta + 2)
      : 60 * ((red - green) / delta + 4);
  if (h < 0) h += 360;
  return { h, s, l };
}

function chroma(value: string): number {
  const channels = value.match(/[\d.]+/g)!.map(Number);
  return (Math.max(...channels) - Math.min(...channels)) / 255;
}

function isRedHue(hue: number): boolean {
  return hue <= 22 || hue >= 338;
}

function isMuddyBrown(color: { h: number; s: number; l: number }): boolean {
  return isRedHue(color.h) && color.l > 0.2 && color.l < 0.48 && color.s > 0.22 && color.s < 0.62;
}

function hueGap(a: number, b: number): number {
  const distance = Math.abs(a - b);
  return Math.min(distance, 360 - distance);
}

function imageData(
  pixels: ReadonlyArray<readonly [number, number, number]>,
  width: number,
): ImageData {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], index) => {
    const offset = index * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  });
  return {
    data,
    width,
    height: pixels.length / width,
    colorSpace: "srgb",
  } as ImageData;
}
