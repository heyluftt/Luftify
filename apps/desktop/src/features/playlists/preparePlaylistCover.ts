import type { Crop } from "../friends/media/MediaCropper";

const MAX_PAYLOAD = 256 * 1024;
export const PLAYLIST_COVER_ACCEPT = "image/jpeg,image/png,image/webp";

/** Spotify accepts base64 JPEGs up to 256 KB, including the encoded payload. */
export async function preparePlaylistCover(file: File, crop: Crop): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.width <= 0 || crop.height <= 0) throw new Error("image");
    for (const limit of [640, 512, 384, 256]) {
      const side = Math.max(1, Math.min(limit, Math.round(crop.width), Math.round(crop.height)));
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = side;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("image");
      // JPEG is opaque; use a neutral backing for transparent PNGs/WebPs.
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--raised").trim();
      ctx.fillRect(0, 0, side, side);
      ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, side, side);
      for (const quality of [0.9, 0.8, 0.7]) {
        const data = canvas.toDataURL("image/jpeg", quality);
        const payload = data.slice(data.indexOf(",") + 1);
        if (data.startsWith("data:image/jpeg;") && payload.length <= MAX_PAYLOAD) return data;
      }
    }
    throw new Error("size");
  } finally { bitmap.close(); }
}
