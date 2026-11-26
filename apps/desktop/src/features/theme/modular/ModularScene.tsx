import { useActiveTheme } from "../useActiveTheme";
import { createMusicLevels, useMusicLevels } from "../useMusicLevels";
import { useThemeArrival } from "../useThemeArrival";
import { ModularBootScope } from "./ModularBootScope";
import { ModularCables } from "./ModularCables";
import { useModularMusic } from "./modularMusic";

const THEME_ID = "luft.modular";
const POWER_MS = 820;
const levels = createMusicLevels();

/** Modular: the module face behind the content, the patch cable, the start scope. */
export function ModularScene() {
  const active = useActiveTheme() === THEME_ID;
  const music = useModularMusic((state) => state.enabled);
  useMusicLevels(levels, active, music);
  useThemeArrival(THEME_ID, () => {
    const root = document.documentElement;
    root.setAttribute("data-md-power", "");
    window.setTimeout(() => root.removeAttribute("data-md-power"), POWER_MS);
  });

  if (!active) return null;
  return (
    <>
      <div className="modular-scene" aria-hidden="true"><ModularBootScope /></div>
      <ModularCables levels={levels} />
    </>
  );
}
