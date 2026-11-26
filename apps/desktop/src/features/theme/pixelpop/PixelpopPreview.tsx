import type { CSSProperties } from "react";
import { pixelpopTheme } from "../../../themes/pixelpopTheme";

const HOUSES = [[0, 9], [5, 14], [11, 7], [15, 18], [22, 11], [27, 15], [33, 8], [37, 20], [44, 12], [49, 16], [55, 9]] as const;
const WINDOWS = [[7, 22], [17, 18], [17, 24], [29, 22], [39, 16], [41, 22], [51, 20]] as const;

/** Own colours, so the tile also shows before the theme's stylesheet is loaded. */
export function PixelpopPreview() {
  const { colors } = pixelpopTheme;
  return (
    <span className="theme-preview theme-preview-pixelpop" aria-hidden="true" style={{
      "--preview-bg": colors.background, "--preview-canvas": colors.surface,
      "--preview-accent": colors.primary, "--preview-text": colors.textPrimary,
    } as CSSProperties}>
      <i /><i /><i />
      <svg viewBox="0 0 60 34" preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges">
        {HOUSES.map(([x, h]) => <rect key={x} x={x} y={34 - h} width={5} height={h} fill="#2f2b52" />)}
        {WINDOWS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#ffc94a" />)}
        <rect x={50} y={3} width={4} height={4} fill={colors.textPrimary} />
        <rect x={52} y={3} width={2} height={3} fill={colors.surface} />
        <rect x={22} y={4} width={1} height={1} fill="#47407a" />
        <rect x={34} y={7} width={1} height={1} fill={colors.textPrimary} />
      </svg>
    </span>
  );
}
