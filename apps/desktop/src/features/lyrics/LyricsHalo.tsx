import type { CSSProperties } from "react";

import { useArtworkPalette } from "../theme/useCoverTint";

export function LyricsHalo({ image }: { image: string | undefined }) {
  const palette = useArtworkPalette(image);
  const [first, second, third] = palette?.pigments ?? [];
  // Covers without clear colors glow in their own light and dark tones.
  const colors = palette
    ? {
        "--lyrics-halo-a": first ?? palette.highlight,
        "--lyrics-halo-b": second ?? palette.primary,
        "--lyrics-halo-c": third ?? second ?? palette.secondary,
      } as CSSProperties
    : undefined;

  return (
    <div className="lyrics-artwork-halo-layers" style={colors}>
      <div className="lyrics-artwork-halo"><i /></div>
      <div className="lyrics-artwork-beam beam-far"><span><i /></span></div>
      <div className="lyrics-artwork-beam beam-near"><span><i /></span></div>
    </div>
  );
}
