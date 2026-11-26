import type { CSSProperties } from "react";
import { modularTheme } from "../../../themes/modularTheme";

/** Own colours, so the tile also shows before the theme's stylesheet is loaded. */
export function ModularPreview() {
  const { colors } = modularTheme;
  return (
    <span className="theme-preview theme-preview-modular" aria-hidden="true" style={{
      "--preview-bg": colors.background, "--preview-canvas": colors.surface,
      "--preview-accent": colors.primary, "--preview-text": colors.textPrimary,
    } as CSSProperties}>
      <i /><i /><i />
      <svg viewBox="0 0 100 56" preserveAspectRatio="none" fill="none">
        <path d="M21 17C30 34 24 40 27 13" stroke="#f4c542" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="21" cy="17" r="2.6" fill="#151618" stroke="#f4c542" strokeWidth="1" />
        <circle cx="27" cy="13" r="2.6" fill="#151618" stroke="#f4c542" strokeWidth="1" />
        <circle cx="92" cy="8" r="1.6" fill={colors.primary} />
      </svg>
    </span>
  );
}
