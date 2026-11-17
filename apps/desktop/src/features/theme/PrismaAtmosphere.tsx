import { useMemo } from "react";
import { usePlayerStore } from "../../stores/playerStore";
import { PrismaScene, prismaSceneStyle } from "./PrismaScene";
import { usePrismaPalette } from "./usePrismaPalette";

/** Two bounded layers crossfade on cover changes; motion is CSS only. */
export function PrismaAtmosphere() {
  const { active, transition } = usePrismaPalette(true);
  const playing = usePlayerStore((store) => store.playback?.isPlaying === true);
  const currentStyle = useMemo(() => prismaSceneStyle(transition.current), [transition.current]);
  const previousStyle = useMemo(
    () => transition.previous ? prismaSceneStyle(transition.previous) : undefined,
    [transition.previous],
  );
  if (!active) return null;
  return (
    <div className={`prisma-atmosphere ${playing ? "is-playing" : "is-paused"}`} aria-hidden="true">
      {previousStyle && (
        <PrismaScene key={`previous-${transition.revision}`} phase="leaving" style={previousStyle} />
      )}
      <PrismaScene key={`current-${transition.revision}`} phase="entering" style={currentStyle} />
      <i className="prisma-atmosphere-vignette" />
    </div>
  );
}