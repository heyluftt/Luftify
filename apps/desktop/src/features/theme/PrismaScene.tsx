import type { CSSProperties } from "react";
import type { CoverPalette } from "./coverPalette";
import { PrismaGlassField } from "./PrismaGlassField";
import { prismaPigments } from "./prismaMaterial";

type PrismaSceneStyle = CSSProperties & Record<`--scene-${string}`, string>;

export function prismaSceneStyle(palette: CoverPalette): PrismaSceneStyle {
  const [first, second, third, fourth] = prismaPigments(palette);
  return {
    "--scene-pigment-1": first,
    "--scene-pigment-2": second,
    "--scene-pigment-3": third,
    "--scene-pigment-4": fourth,
    "--scene-primary": palette.primary,
    "--scene-secondary": palette.secondary,
    "--scene-highlight": palette.highlight,
    "--scene-glass-primary": palette.uiPrimary,
    "--scene-glass-secondary": palette.uiSecondary,
    "--scene-shadow": palette.shadow,
    "--scene-focus-x": `${palette.focusX}%`,
    "--scene-focus-y": `${palette.focusY}%`,
    "--scene-field-strength": String(Math.min(1, .7 + palette.energy * .4)),
    "--scene-glass-strength": String(.84 + palette.contrast * .16),
  };
}

/** Can be previewed without playback or cover fetching. */
export function PrismaScene({ phase, style }: { phase: "entering" | "leaving"; style: PrismaSceneStyle }) {
  return (
    <div className={`prisma-scene is-${phase}`} style={style}>
      <div className="prisma-scene-light">
        <i className="prisma-light-wash prisma-light-wash-primary" />
        <i className="prisma-light-wash prisma-light-wash-secondary" />
        <i className="prisma-light-wash prisma-light-wash-tertiary" />
        <i className="prisma-light-wash prisma-light-wash-quaternary" />
        <div className="prisma-glass-position"><PrismaGlassField /></div>
      </div>
    </div>
  );
}
