import { useId } from "react";
import { GlowFrame, PrismFrame } from "./frames/LightFrames";
import { AccentFrame, AurumFrame } from "./frames/MetalFrames";
import { OrbitFrame, PulseFrame } from "./frames/MotionFrames";

export const MATERIAL_FRAMES = new Set(["accent", "glow", "prism", "orbit", "aurum", "pulse"]);

/**
 * The drawn frames (styles in profile-frame-art.css). Most sit behind the
 * picture; the orbit's near half also passes in front of it.
 */
export function AvatarFrameArt({ frame }: { frame: string }) {
  const id = useId().replace(/:/g, "");
  if (!MATERIAL_FRAMES.has(frame)) return null;
  return <>
    <svg className="avatar-frame-art" data-material={frame} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <FrameDefs id={id} />
      {frame === "accent" && <AccentFrame id={id} />}
      {frame === "glow" && <GlowFrame id={id} />}
      {frame === "prism" && <PrismFrame id={id} />}
      {frame === "orbit" && <OrbitFrame id={id} layer="back" />}
      {frame === "aurum" && <AurumFrame id={id} />}
      {frame === "pulse" && <PulseFrame id={id} />}
    </svg>
    {frame === "orbit" && <svg className="avatar-frame-art" data-layer="front" data-material={frame} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <FrameDefs id={`${id}f`} />
      <OrbitFrame id={`${id}f`} layer="front" />
    </svg>}
  </>;
}

/** Gradients and soft lights the frames share; colours come from the profile (--frame…). */
function FrameDefs({ id }: { id: string }) {
  return <defs>
    <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="var(--frame-light)" /><stop offset=".22" stopColor="var(--frame)" />
      <stop offset=".48" stopColor="var(--frame-dark)" /><stop offset=".62" stopColor="var(--frame)" />
      <stop offset=".8" stopColor="var(--frame-light)" /><stop offset="1" stopColor="var(--frame-dark)" />
    </linearGradient>
    <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="var(--profile-gold-light)" /><stop offset=".25" stopColor="var(--profile-gold)" />
      <stop offset=".5" stopColor="var(--profile-gold-shadow)" /><stop offset=".68" stopColor="var(--profile-gold)" />
      <stop offset=".85" stopColor="var(--profile-gold-light)" /><stop offset="1" stopColor="var(--profile-gold)" />
    </linearGradient>
    {["var(--frame)", "var(--frame-facet)", "var(--frame-facet-2)"].map((color, index) =>
      <linearGradient key={index} id={`${id}-glass-${index}`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="var(--profile-paper)" stopOpacity=".85" /><stop offset=".45" stopColor={color} />
        <stop offset="1" stopColor={color} stopOpacity=".55" />
      </linearGradient>)}
    <linearGradient id={`${id}-orbit`} x1="0" x2="1">
      <stop stopColor="var(--frame-facet)" /><stop offset=".5" stopColor="var(--frame-light)" /><stop offset="1" stopColor="var(--frame)" />
    </linearGradient>
    <linearGradient id={`${id}-bar`} x1="0" y1="1" x2="0" y2="0">
      <stop stopColor="var(--frame)" /><stop offset="1" stopColor="var(--frame-light)" />
    </linearGradient>
    <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".9" /></filter>
    <filter id={`${id}-bloom`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2" /></filter>
    <filter id={`${id}-soft-glow`} x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="1.4" result="blur" />
      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
    {/* The orbit's near and far halves, in the ring's own tilted coordinates. */}
    <mask id={`${id}-near`} maskUnits="userSpaceOnUse" x="-60" y="-60" width="240" height="240">
      <rect x="-60" y="60" width="240" height="120" fill="white" />
    </mask>
    <mask id={`${id}-far`} maskUnits="userSpaceOnUse" x="-60" y="-60" width="240" height="240">
      <rect x="-60" y="-60" width="240" height="120" fill="white" />
    </mask>
  </defs>;
}
