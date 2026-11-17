import { describe, expect, it } from "vitest";
import { DEFAULT_COVER_PALETTE, createCoverPaletteFromImageData } from "../src/features/theme/coverPalette";
import { intensifyPrismaPalette, normalizePrismaPalette, prismaSurfacesFromPalette } from "../src/features/theme/prismaMaterial";

describe("Prisma reading material", () => {
  it("keeps every scene and UI pigment achromatic for a black-and-white cover", () => {
    const extracted = createCoverPaletteFromImageData(solidImage([108, 108, 108]), "neutral:purple");
    const normalized = normalizePrismaPalette(extracted);
    for (const pigment of ["primary", "secondary", "highlight", "shadow", "uiPrimary", "uiSecondary"] as const) {
      expect(new Set(channels(normalized[pigment])).size).toBe(1);
      expect(Math.abs(luminance(normalized[pigment]) - luminance(extracted[pigment]))).toBeLessThan(0.004);
    }
  });

  it("lets only a faint tint return for weakly colored covers and leaves the idle palette unchanged", () => {
    const extracted = { ...DEFAULT_COVER_PALETTE, vividness: 0.01 };
    const normalized = normalizePrismaPalette(extracted);
    const colorGap = (color: string) => Math.max(...channels(color)) - Math.min(...channels(color));
    expect(colorGap(normalized.uiPrimary)).toBeGreaterThan(0);
    expect(colorGap(normalized.uiPrimary)).toBeLessThan(colorGap(extracted.uiPrimary) * 0.2);
    expect(Math.abs(luminance(normalized.uiPrimary) - luminance(extracted.uiPrimary))).toBeLessThan(0.004);
    expect(normalizePrismaPalette(DEFAULT_COVER_PALETTE)).toBe(DEFAULT_COVER_PALETTE);
  });

  it("keeps black-and-white cover surfaces neutral even when their palette has a synthetic tint", () => {
    for (const identity of ["neutral:a", "neutral:b", "neutral:c"]) {
      const palette = createCoverPaletteFromImageData(solidImage([108, 108, 108]), identity);
      const material = prismaSurfacesFromPalette(palette);
      for (const surface of [material.ink, material.panel, material.raised]) {
        expect(new Set(channels(surface)).size).toBe(1);
      }
    }
  });

  it("dyes the room clearly in a warm cover's color, leaning red instead of brown", () => {
    const palette = createCoverPaletteFromImageData(solidImage([230, 112, 24]));
    const material = prismaSurfacesFromPalette(palette);
    const [red, green, blue] = channels(material.panel);
    expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeGreaterThan(12);
    expect(red).toBeGreaterThan(green * 1.6);
    expect(red).toBeGreaterThan(blue);
    expect(channels(intensifyPrismaPalette(palette).uiPrimary)[0]).toBeGreaterThan(channels(palette.uiPrimary)[2]);
  });

  it("provides at least 4.5:1 label contrast for cover accents including saturated blue and middle grey", () => {
    const accents = [
      "rgb(0 0 255)", "rgb(0 255 0)", "rgb(255 0 0)", "rgb(255 255 0)",
      "rgb(116 117 118)", "rgb(255 255 255)", "rgb(0 0 0)",
      ...[[220, 32, 46], [25, 195, 92], [98, 46, 176], [230, 112, 24]].map((color) =>
        createCoverPaletteFromImageData(solidImage(color)).uiPrimary),
    ];
    for (const uiPrimary of accents) {
      const material = prismaSurfacesFromPalette({ ...DEFAULT_COVER_PALETTE, uiPrimary });
      expect(contrast(uiPrimary, material.onAccent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the main reading text above 12:1 contrast across vivid cover surfaces", () => {
    for (const color of [[220, 32, 46], [25, 195, 92], [25, 112, 240], [230, 112, 24]]) {
      const material = prismaSurfacesFromPalette(createCoverPaletteFromImageData(solidImage(color)));
      for (const surface of [material.ink, material.panel, material.raised]) {
        expect(contrast(surface, "rgb(243 241 238)")).toBeGreaterThan(12);
      }
    }
  });
});

function solidImage([r, g, b]: number[]): ImageData {
  return { data: new Uint8ClampedArray([r!, g!, b!, 255]), width: 1, height: 1, colorSpace: "srgb" } as ImageData;
}

function channels(color: string): [number, number, number] {
  const match = color.match(/^rgb\((\d+) (\d+) (\d+)\)$/);
  if (!match) throw new Error(`Expected rgb color: ${color}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function luminance(color: string): number {
  return channels(color).reduce((total, channel, index) => {
    const value = channel / 255;
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return total + linear * [0.2126, 0.7152, 0.0722][index]!;
  }, 0);
}
