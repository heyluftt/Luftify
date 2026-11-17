import { useRef, type ReactNode } from "react";
import { useSmoothProgress } from "./useSmoothProgress";

export function SmoothProgressTrack({
  positionMs,
  durationMs,
  running,
  trackKey,
  pixelStep,
  children,
  className,
}: {
  positionMs: number;
  durationMs: number;
  running: boolean;
  trackKey?: string;
  /** See `useSmoothProgress`: for windows beside the main one. */
  pixelStep?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const fill = useRef<HTMLElement | null>(null);
  useSmoothProgress(fill, {
    positionMs,
    durationMs,
    running,
    ...(trackKey ? { trackKey } : {}),
    ...(pixelStep ? { pixelStep } : {}),
  });

  return (
    <div className={["smooth-progress", className].filter(Boolean).join(" ")}>
      <span className="smooth-progress-rail" aria-hidden="true" />
      <span ref={fill} className="smooth-progress-fill" aria-hidden="true" />
      {children}
    </div>
  );
}
