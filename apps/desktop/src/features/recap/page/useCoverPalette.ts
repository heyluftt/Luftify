import { useEffect, useState, type CSSProperties } from "react";
import { DEFAULT_COVER_PALETTE, extractCoverPalette, type CoverPalette } from "../../theme/coverPalette";
import { useCoverData } from "../useRecaps";

/** The colours of a cover as CSS variables (`--recap-primary` …), plus the cover as data. */
export function useCoverPalette(coverUri: string | null | undefined) {
  const coverData = useCoverData(coverUri);
  const [palette, setPalette] = useState<CoverPalette>(DEFAULT_COVER_PALETTE);
  useEffect(() => {
    if (!coverData) return;
    let current = true;
    void extractCoverPalette(coverData).then((next) => { if (current) setPalette(next); });
    return () => { current = false; };
  }, [coverData]);
  const style = {
    "--recap-primary": palette.primary,
    "--recap-secondary": palette.secondary,
    "--recap-highlight": palette.highlight,
    "--recap-shadow": palette.shadow,
    "--recap-angle": `${palette.angle}deg`,
  } as CSSProperties;
  return { coverData, style };
}
