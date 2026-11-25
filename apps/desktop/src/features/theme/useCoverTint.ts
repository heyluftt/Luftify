import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties } from "react";
import { desktopApi } from "../../services/desktopApi";
import { extractCoverPalette, type CoverPalette } from "./coverPalette";

export function useArtworkPalette(coverUri: string | undefined): CoverPalette | undefined {
  const remote = coverUri?.startsWith("https://") ? coverUri : undefined;
  const direct = coverUri?.startsWith("data:image/") ? coverUri : undefined;
  const cover = useQuery({
    queryKey: ["cover", remote],
    queryFn: () => desktopApi.coverData(remote!),
    enabled: Boolean(remote),
    staleTime: Infinity,
    retry: false,
  });
  const source = direct ?? cover.data;
  const [palette, setPalette] = useState<CoverPalette>();

  useEffect(() => {
    if (!source) {
      setPalette(undefined);
      return;
    }
    let cancelled = false;
    extractCoverPalette(source, coverUri ?? source)
      .then((next) => { if (!cancelled) setPalette(next); })
      .catch(() => { if (!cancelled) setPalette(undefined); });
    return () => { cancelled = true; };
  }, [source, coverUri]);

  return palette;
}

/**
 * Cover colors as CSS variables for artwork-lit surfaces. Shares the cover
 * query cache with AlbumArt, so no extra request is made. Without a palette
 * the CSS falls back to theme tokens.
 */
export function useCoverTint(coverUri: string | undefined): CSSProperties | undefined {
  const palette = useArtworkPalette(coverUri);
  if (!palette) return undefined;
  // Light uses the UI-tuned variants (readable on any surface); the record
  // label keeps the cover's actual colors.
  return {
    "--art-a": palette.uiPrimary,
    "--art-b": palette.uiSecondary,
    "--art-label-a": palette.primary,
    "--art-label-b": palette.secondary,
  } as CSSProperties;
}
