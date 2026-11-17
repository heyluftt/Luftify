export interface CoverPalette {
  primary: string;
  secondary: string;
  highlight: string;
  shadow: string;
  uiPrimary: string;
  uiSecondary: string;
  energy: number;
  contrast: number;
  focusX: number;
  focusY: number;
  angle: number;
  /** Mean chroma of the whole cover, 0 (black and white) to ~0.6 (vivid). */
  vividness: number;
  /**
   * Up to four clearly different colors of the cover, as bright as they can
   * glow; Prisma lights its room with them. Empty for neutral covers.
   */
  pigments: string[];
}

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };
type Bucket = Rgb & { count: number };
type Candidate = Rgb & Hsl & { chroma: number; count: number; prominence: number };
type VisualStats = {
  energy: number;
  contrast: number;
  focusX: number;
  focusY: number;
  angle: number;
};

const SAMPLE_SIZE = 44;
const MAX_CACHE_ENTRIES = 48;
const PIGMENT_HUE_STEP = 20;
const NEUTRAL_HUE_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [198, 242],
  [224, 284],
  [256, 314],
  [286, 342],
  [318, 18],
  [348, 52],
  [16, 78],
  [46, 128],
  [92, 164],
  [148, 198],
];
const paletteCache = new Map<string, Promise<CoverPalette>>();

export const DEFAULT_COVER_PALETTE: CoverPalette = {
  primary: "rgb(86 142 152)",
  secondary: "rgb(138 116 128)",
  highlight: "rgb(208 202 194)",
  shadow: "rgb(10 11 13)",
  uiPrimary: "rgb(126 176 186)",
  uiSecondary: "rgb(168 146 158)",
  energy: 0.58,
  contrast: 0.42,
  focusX: 74,
  focusY: 19,
  angle: -14,
  vividness: 0.3,
  pigments: ["rgb(96 176 190)", "rgb(176 132 156)", "rgb(132 150 204)"],
};

export function extractCoverPalette(
  imageSource: string,
  cacheKey = imageSource,
): Promise<CoverPalette> {
  const normalizedKey = compactCacheKey(cacheKey);
  const cached = paletteCache.get(normalizedKey);
  if (cached) return cached;

  const pending = sampleImage(imageSource)
    .then((image) => createCoverPaletteFromImageData(image, normalizedKey))
    .catch(() => DEFAULT_COVER_PALETTE);
  paletteCache.set(normalizedKey, pending);
  trimCache();
  return pending;
}

function compactCacheKey(value: string): string {
  if (!value.startsWith("data:")) return value;
  let hash = 2_166_136_261;
  const step = Math.max(1, Math.floor(value.length / 192));
  for (let index = 0; index < value.length; index += step) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `data:${value.length}:${hash >>> 0}`;
}

export function paletteSignature(palette: CoverPalette): string {
  return [
    palette.primary,
    palette.secondary,
    palette.highlight,
    palette.focusX.toFixed(1),
    palette.focusY.toFixed(1),
    palette.angle.toFixed(1),
    palette.vividness.toFixed(2),
    ...palette.pigments,
  ].join("|");
}

export { prismaSurfacesFromPalette, type PrismaSurfaces } from "./prismaMaterial";

async function sampleImage(source: string): Promise<ImageData> {
  const image = new Image();
  image.decoding = "async";
  if (!source.startsWith("data:")) image.crossOrigin = "anonymous";

  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Cover could not be decoded"));
  });
  image.src = source;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
}

export function createCoverPaletteFromImageData(
  image: ImageData,
  sourceIdentity?: string,
): CoverPalette {
  const buckets = new Map<number, Bucket>();
  let average: Rgb & { count: number } = { r: 0, g: 0, b: 0, count: 0 };
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let chromaSum = 0;
  let focusWeight = 0;
  let focusXSum = 0;
  let focusYSum = 0;

  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3] ?? 0;
    if (alpha < 180) continue;
    const r = image.data[offset] ?? 0;
    const g = image.data[offset + 1] ?? 0;
    const b = image.data[offset + 2] ?? 0;
    average.r += r;
    average.g += g;
    average.b += b;
    average.count += 1;
    const pixel = rgbToHsl({ r, g, b });
    chromaSum += chromaOf({ r, g, b });
    luminanceSum += pixel.l;
    luminanceSquaredSum += pixel.l * pixel.l;
    const pixelIndex = offset / 4;
    const x = pixelIndex % image.width;
    const y = Math.floor(pixelIndex / image.width);
    const usefulLight = 1 - Math.min(1, Math.abs(pixel.l - 0.52) * 1.5);
    const visualWeight = 0.08
      + pixel.s ** 1.35 * (0.65 + usefulLight * 0.35)
      + Math.abs(pixel.l - 0.5) * 0.1;
    focusWeight += visualWeight;
    focusXSum += x * visualWeight;
    focusYSum += y * visualWeight;

    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  if (!average.count || !buckets.size) return DEFAULT_COVER_PALETTE;
  const averageRgb = {
    r: average.r / average.count,
    g: average.g / average.count,
    b: average.b / average.count,
  };
  const rawFocusX = focusWeight > 0
    ? focusXSum / focusWeight / Math.max(1, image.width - 1) * 100
    : 50;
  const rawFocusY = focusWeight > 0
    ? focusYSum / focusWeight / Math.max(1, image.height - 1) * 100
    : 50;
  const meanLuminance = luminanceSum / average.count;
  const vividness = chromaSum / average.count;
  const luminanceVariance = Math.max(0, luminanceSquaredSum / average.count - meanLuminance ** 2);
  const baseStats = {
    contrast: clamp(Math.sqrt(luminanceVariance) * 3.1, 0.18, 1),
    focusX: clamp(58 + rawFocusX * 0.26, 58, 84),
    focusY: clamp(8 + rawFocusY * 0.44, 8, 52),
  };
  const candidates = [...buckets.values()]
    .map(toCandidate)
    .filter((candidate) => candidate.l > 0.035 && candidate.l < 0.965)
    .sort((a, b) => b.prominence - a.prominence);

  if (!candidates.length) {
    return { ...neutralPalette(averageRgb, visualStats(baseStats, 0, 0), sourceIdentity), vividness };
  }
  const primary = candidates[0]!;
  if (primary.chroma < 0.05 && candidates.every((candidate) => candidate.chroma < 0.1)) {
    return {
      ...neutralPalette(averageRgb, visualStats(baseStats, primary.h, colorfulness(primary.chroma)), sourceIdentity),
      vividness,
    };
  }
  const pigments = coverPigments([...buckets.values()].map(toCandidate), vividness).map(rgbCss);

  const averageHsl = rgbToHsl(averageRgb);
  const mass = [...buckets.values()].map(toCandidate).sort((a, b) => b.count - a.count)[0] ?? primary;
  const accentOnDark = averageHsl.l < 0.16
    && chromaOf(averageRgb) < 0.06
    && primary.chroma > 0.25;

  const secondaryPick = candidates
    .slice(1)
    .map((candidate) => ({
      candidate,
      score: candidate.prominence * (0.42 + colorDistance(primary, candidate) * 2.25),
    }))
    .filter(({ candidate }) => hueDistance(primary.h, candidate.h) > 14 || colorDistance(primary, candidate) > 0.18)
    .sort((a, b) => b.score - a.score)[0]?.candidate
    ?? derivedCompanion(primary);
  const secondary = accentOnDark && chromaOf(secondaryPick) < 0.1
    ? mixRgb(averageRgb, primary, 0.08)
    : secondaryPick;

  const highlight = candidates
    .map((candidate) => ({
      candidate,
      score: candidate.prominence * (0.7 + candidate.l) * (0.75 + colorDistance(primary, candidate)),
    }))
    .filter(({ candidate }) => candidate.l >= Math.min(0.72, primary.l + 0.08))
    .sort((a, b) => b.score - a.score)[0]?.candidate
    ?? relight(primary, 0.84, 0.02, 0.12, 0.6);

  const roomSource = accentOnDark ? mixRgb(mass, primary, 0.08) : mixRgb(averageRgb, primary, 0.22);
  const shadow = roomShadow(roomSource, primary);

  return {
    primary: rgbCss(atmospherePigment(primary, accentOnDark, accentCeiling(vividness) * 0.7)),
    secondary: rgbCss(atmospherePigment(secondary, accentOnDark, accentCeiling(vividness) * 0.7)),
    highlight: rgbCss(pigmentColor(highlight, 0.08, 0.28, 0.7, 0.86)),
    shadow: rgbCss(shadow),
    uiPrimary: rgbCss(uiPigment(primary, accentCeiling(vividness))),
    uiSecondary: rgbCss(uiPigment(secondary, accentCeiling(vividness))),
    ...visualStats(
      baseStats,
      primary.h,
      colorfulness(accentOnDark ? Math.min(primary.chroma, 0.4) : Math.max(primary.chroma, chromaOf(secondary))),
      accentOnDark,
    ),
    vividness,
    pigments,
  };
}

/**
 * The cover's main colors by hue, weighted by colorful area: a gradient
 * spreads one color over many buckets, so buckets alone favored small flat
 * shapes. A single-hue cover gets two neighboring hues for depth.
 */
function coverPigments(buckets: Candidate[], vividness: number): Rgb[] {
  const bins = new Map<number, Rgb & { weight: number }>();
  for (const bucket of buckets) {
    if (bucket.chroma < 0.1 || bucket.l < 0.08 || bucket.l > 0.94) continue;
    const key = Math.round(bucket.h / PIGMENT_HUE_STEP) % (360 / PIGMENT_HUE_STEP);
    const weight = bucket.count * bucket.chroma;
    const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
    bin.r += bucket.r * weight;
    bin.g += bucket.g * weight;
    bin.b += bucket.b * weight;
    bin.weight += weight;
    bins.set(key, bin);
  }
  const ranked = [...bins.values()]
    .map((bin) => ({ color: { r: bin.r / bin.weight, g: bin.g / bin.weight, b: bin.b / bin.weight }, weight: bin.weight }))
    .sort((a, b) => b.weight - a.weight);
  const topWeight = ranked[0]?.weight ?? 0;
  const picked: Rgb[] = [];
  for (const { color, weight } of ranked) {
    if (picked.length === 4 || weight < topWeight * 0.05) break;
    const hue = rgbToHsl(color).h;
    if (picked.every((other) => hueDistance(rgbToHsl(other).h, hue) > 30)) picked.push(color);
  }
  if (picked.length === 1) {
    const { h, s, l } = rgbToHsl(picked[0]!);
    // Neighbors in the lime zone look sickly next to gold or orange; those turn warm.
    const neighbor = (shift: number) => {
      const hue = (h + shift + 360) % 360;
      return hue > 52 && hue < 96 ? (h + 320) % 360 : hue;
    };
    picked.push(hslToRgb({ h: neighbor(22), s, l: Math.min(0.62, l + 0.08) }), hslToRgb({ h: neighbor(-22), s, l }));
  }
  // Colorful covers glow at full strength; a few specks on a dark cover stay soft.
  const ceiling = clamp(0.12 + vividness * 1.6, 0.12, 0.88);
  return picked.map((color) => relight(color, clamp(rgbToHsl(color).l, 0.44, 0.62), 0.1, ceiling, 1.3));
}

function toCandidate(bucket: Bucket): Candidate {
  const rgb = {
    r: bucket.r / bucket.count,
    g: bucket.g / bucket.count,
    b: bucket.b / bucket.count,
  };
  const hsl = rgbToHsl(rgb);
  const chroma = chromaOf(rgb);
  const usefulLight = 1 - Math.min(1, Math.abs(hsl.l - 0.5) * 1.45);
  return {
    ...rgb,
    ...hsl,
    chroma,
    count: bucket.count,
    prominence: bucket.count ** 0.7 * (0.32 + chroma * 3.2) * (0.56 + usefulLight * 0.44),
  };
}

function isBrownRiskHue(hue: number): boolean {
  return hueDistance(hue, 22) < 30;
}

function atmospherePigment(color: Rgb, quiet: boolean, ceiling = 0.48): Rgb {
  const hsl = rgbToHsl(color);
  const warm = isBrownRiskHue(hsl.h);
  const lightness = clamp(hsl.l, warm ? 0.15 : 0.2, quiet || warm ? 0.26 : 0.46);
  return relight(color, lightness, 0.02, Math.min(ceiling, quiet || warm ? 0.3 : 0.48), 1.05);
}

function uiPigment(color: Rgb, ceiling = 0.6): Rgb {
  const hsl = rgbToHsl(color);
  const warm = isBrownRiskHue(hsl.h);
  const lightness = clamp(hsl.l, warm ? 0.52 : 0.5, warm ? 0.6 : 0.66);
  // A little extra color keeps accents recognizable; a muted cover stays muted.
  return relight(color, lightness, 0.04, Math.min(ceiling, warm ? 0.5 : 0.6), 1.35);
}

/** Highest accent chroma for a cover of the given overall colorfulness. */
function accentCeiling(vividness: number): number {
  return clamp(0.1 + vividness * 1.2, 0.1, 0.6);
}

function roomShadow(mass: Rgb, accent: Rgb): Rgb {
  const massHsl = rgbToHsl(mass);
  const accentHsl = rgbToHsl(accent);
  const hue = massHsl.s > 0.06 ? massHsl.h : accentHsl.h;
  const warm = isBrownRiskHue(hue);
  return hslToRgb({
    h: hue,
    s: clamp(massHsl.s * 0.75 + accentHsl.s * (massHsl.s < 0.08 ? 0.16 : 0.08), 0.08, warm ? 0.3 : 0.42),
    l: 0.052,
  });
}

function pigmentColor(
  color: Rgb,
  minS: number,
  maxS: number,
  minL: number,
  maxL: number,
): Rgb {
  const hsl = rgbToHsl(color);
  const lightness = clamp(hsl.l, minL, maxL);
  const room = 1 - Math.abs(2 * lightness - 1);
  return relight(color, lightness, minS * room * 0.25, maxS * room, 0.95);
}

/**
 * Moves a color to `lightness` while keeping its chroma (colorfulness), not
 * its HSL saturation. Relighting a dark navy with its HSL saturation turned
 * a nearly black cover into a vivid blue accent.
 */
function relight(
  color: Rgb,
  lightness: number,
  minChroma: number,
  maxChroma: number,
  boost = 1,
): Rgb {
  const hsl = rgbToHsl(color);
  const room = 1 - Math.abs(2 * lightness - 1);
  const chroma = clamp(chromaOf(color) * boost, minChroma, Math.min(maxChroma, room));
  return hslToRgb({ h: hsl.h, s: room > 0 ? clamp(chroma / room, 0, 1) : 0, l: lightness });
}

function chromaOf({ r, g, b }: Rgb): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Chroma rescaled to the old saturation range the energy curve expects. */
function colorfulness(chroma: number): number {
  return clamp(chroma * 1.4, 0, 1);
}

function neutralPalette(
  average: Rgb,
  stats: VisualStats,
  sourceIdentity?: string,
): CoverPalette {
  const averageHsl = rgbToHsl(average);
  const [sourceHue, sourceSecondaryHue] = neutralHuePair(sourceIdentity);
  const coverHueWeight = clamp(averageHsl.s / 0.055, 0, 1);
  const hue = mixHue(sourceHue, averageHsl.h, coverHueWeight);
  const secondaryHue = mixHue(sourceSecondaryHue, (averageHsl.h + 18) % 360, coverHueWeight);
  // Chroma, not saturation: grey and black-and-white covers stay grey with a
  // faint tint instead of picking up a noticeable color of their own.
  const tint = clamp(chromaOf(average) * 1.5, 0.03, 0.09);
  const tinted = (tintHue: number, chroma: number, lightness: number) => {
    const room = 1 - Math.abs(2 * lightness - 1);
    return hslToRgb({ h: tintHue, s: room > 0 ? clamp(chroma / room, 0, 1) : 0, l: lightness });
  };
  const primaryLight = clamp(averageHsl.l + 0.12, 0.4, 0.56);
  const secondaryLight = clamp(averageHsl.l + 0.02, 0.32, 0.48);
  return {
    primary: rgbCss(tinted(hue, tint, primaryLight)),
    secondary: rgbCss(tinted(secondaryHue, tint * 0.8, secondaryLight)),
    highlight: rgbCss(tinted(hue, tint * 0.5, 0.8)),
    shadow: rgbCss(tinted(hue, tint * 0.2, 0.05)),
    uiPrimary: rgbCss(tinted(hue, Math.max(0.05, tint), 0.64)),
    uiSecondary: rgbCss(tinted(secondaryHue, Math.max(0.045, tint * 0.9), 0.58)),
    ...stats,
    vividness: chromaOf(average),
    pigments: [],
  };
}

function neutralHuePair(sourceIdentity?: string): readonly [number, number] {
  if (!sourceIdentity) return [210, 238];
  let hash = 2_166_136_261;
  for (let index = 0; index < sourceIdentity.length; index += 1) {
    hash ^= sourceIdentity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return NEUTRAL_HUE_PAIRS[(hash >>> 0) % NEUTRAL_HUE_PAIRS.length]!;
}

function mixHue(from: number, to: number, amount: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * amount + 360) % 360;
}

function derivedCompanion(color: Candidate): Rgb {
  return relight(color, clamp(color.l * 0.58, 0.12, 0.3), 0.03, 0.3, 0.6);
}

function visualStats(
  base: Pick<VisualStats, "contrast" | "focusX" | "focusY">,
  hue: number,
  saturation: number,
  quiet = false,
): VisualStats {
  const focusAngle = Math.atan2(base.focusY - 30, base.focusX - 71) * 180 / Math.PI;
  return {
    ...base,
    energy: quiet
      ? clamp(0.3 + saturation * 0.22 + base.contrast * 0.1, 0.3, 0.56)
      : clamp(0.32 + saturation * 0.4 + base.contrast * 0.14, 0.32, 0.88),
    angle: clamp(-18 + (hue / 360 - 0.5) * 18 + focusAngle * 0.08, -29, 4),
  };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const l = (max + min) / 2;
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

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = h / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = section < 1 ? [chroma, x, 0]
    : section < 2 ? [x, chroma, 0]
      : section < 3 ? [0, chroma, x]
        : section < 4 ? [0, x, chroma]
          : section < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = l - chroma / 2;
  return { r: (red + match) * 255, g: (green + match) * 255, b: (blue + match) * 255 };
}

function colorDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt(
    ((a.r - b.r) / 255) ** 2
    + ((a.g - b.g) / 255) ** 2
    + ((a.b - b.b) / 255) ** 2,
  ) / Math.sqrt(3);
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b);
  return Math.min(distance, 360 - distance);
}

function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rgbCss(color: Rgb): string {
  return `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)})`;
}

function trimCache() {
  while (paletteCache.size > MAX_CACHE_ENTRIES) {
    const oldest = paletteCache.keys().next().value;
    if (typeof oldest !== "string") return;
    paletteCache.delete(oldest);
  }
}
