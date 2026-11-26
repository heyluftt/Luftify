import { createMusicLevels, useMusicLevels } from "../useMusicLevels";
import { usePixelpopMusic } from "./pixelpopMusic";

/** Read by the skyline every frame. */
export const pixelLevels = createMusicLevels();

export function usePixelPulse(active: boolean) {
  const enabled = usePixelpopMusic((state) => state.enabled);
  useMusicLevels(pixelLevels, active, enabled);
}
