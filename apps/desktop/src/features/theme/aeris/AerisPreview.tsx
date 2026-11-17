import type { CSSProperties } from "react";
import { aerisTheme } from "../../../themes/aerisTheme";

/** Self-contained colours: previews also work before the bundle is loaded. */
export function AerisPreview() {
  const { colors } = aerisTheme;
  return <span className="theme-preview theme-preview-aeris" aria-hidden="true" style={{
    "--preview-bg": colors.background, "--preview-canvas": colors.surface,
    "--preview-white": colors.surfaceElevated, "--preview-accent": colors.primary,
  } as CSSProperties}>
    <i /><i /><i />
    <svg viewBox="0 0 180 100" preserveAspectRatio="none" fill="none">
      <path d="M65 102C100 73 105 41 143 37S182 22 191 1L191 35C150 49 118 71 91 102Z" fill="var(--preview-white)" fillOpacity=".65" />
      <path d="M132-6C111 16 120 29 140 41C152 52 140 65 122 69L139 74C165 56 160 42 145 30C131 20 132 9 146-6Z" fill="var(--preview-accent)" fillOpacity=".35" />
      <path d="M55 102C87 65 100 35 138 29S185 18 192-3" stroke="var(--preview-white)" strokeOpacity=".55" strokeWidth=".8" />
    </svg>
  </span>;
}
