export type CoverSize = "tiny" | "small" | "medium" | "large" | "feature";

/** Largest CSS width each AlbumArt size is shown at (see styles/ds/media.css). */
const DISPLAY_WIDTH: Record<CoverSize, number> = {
  tiny: 40,
  small: 48,
  large: 160,
  medium: 240,
  feature: 640,
};

/**
 * Spotify serves the same image in a few sizes; the size is part of the
 * image id. Rows showing a 40 px cover used to load, transfer (as base64)
 * and decode the 640 px original. Only well-known patterns are rewritten;
 * anything else keeps its URL.
 */
const IMAGE_ID_VARIANTS: Array<{ sizes: Array<[number, string]> }> = [
  // Albums and tracks.
  { sizes: [[64, "ab67616d00004851"], [300, "ab67616d00001e02"], [640, "ab67616d0000b273"]] },
  // Artists.
  { sizes: [[160, "ab6761610000f178"], [320, "ab67616100005174"], [640, "ab6761610000e5eb"]] },
];
const IMAGE_ID = /^(https:\/\/i\.scdn\.co\/image\/)([0-9a-f]{16})([0-9a-f]{24})$/;
const MOSAIC = /^(https:\/\/mosaic\.scdn\.co\/)(60|300|640)(\/.+)$/;
const MOSAIC_SIZES = [60, 300, 640];

export function sizedCoverUrl(url: string, size: CoverSize, pixelRatio = currentPixelRatio()): string {
  const target = DISPLAY_WIDTH[size] * Math.max(1, pixelRatio);

  const image = IMAGE_ID.exec(url);
  if (image) {
    const [, base, prefix, id] = image;
    const family = IMAGE_ID_VARIANTS.find((entry) => entry.sizes.some(([, known]) => known === prefix));
    if (!family) return url;
    const [, chosen] = family.sizes.find(([width]) => width >= target) ?? family.sizes.at(-1)!;
    return `${base}${chosen}${id}`;
  }

  const mosaic = MOSAIC.exec(url);
  if (mosaic) {
    const [, base, , rest] = mosaic;
    const width = MOSAIC_SIZES.find((candidate) => candidate >= target) ?? 640;
    return `${base}${width}${rest}`;
  }

  return url;
}

function currentPixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}
