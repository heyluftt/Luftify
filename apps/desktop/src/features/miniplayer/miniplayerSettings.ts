import type { MiniPlayerSettings } from "../../types/tauri";

export const MINIPLAYER_LABEL = "miniplayer";

export const DEFAULT_MINIPLAYER_SETTINGS: MiniPlayerSettings = {
  scale: 1,
  opacityPercent: 94,
  alwaysOnTop: true,
  clickThrough: false,
  positionX: null,
  positionY: null,
};
