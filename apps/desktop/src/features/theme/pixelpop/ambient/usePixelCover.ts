import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { desktopApi } from "../../../../services/desktopApi";

/** The cover shrunk to `size` × `size` colours (RGBA), for the mosaic. */
export function usePixelCover(coverUri: string | undefined, size: number): Uint8ClampedArray | undefined {
  const remote = coverUri?.startsWith("https://") ? coverUri : undefined;
  const direct = coverUri?.startsWith("data:image/") ? coverUri : undefined;
  // Same query as AlbumArt and the cover palette, so no extra request.
  const cover = useQuery({
    queryKey: ["cover", remote],
    queryFn: () => desktopApi.coverData(remote!),
    enabled: Boolean(remote),
    staleTime: Infinity,
    retry: false,
    // old cover stays until the next one is there, no flash on track change
    placeholderData: keepPreviousData,
  });
  const source = direct ?? (remote ? cover.data : undefined);
  const [pixels, setPixels] = useState<Uint8ClampedArray>();

  useEffect(() => {
    if (!source) {
      setPixels(undefined);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, size, size);
      try {
        setPixels(context.getImageData(0, 0, size, size).data);
      } catch {
        setPixels(undefined);
      }
    };
    image.onerror = () => { if (!cancelled) setPixels(undefined); };
    image.src = source;
    return () => { cancelled = true; };
  }, [size, source]);

  return pixels;
}
