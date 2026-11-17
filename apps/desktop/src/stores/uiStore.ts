import { create } from "zustand";

interface UiStore {
  queueOpen: boolean;
  recentOpen: boolean;
  setRecentOpen: (open: boolean) => void;
  commandPaletteOpen: boolean;
  /** What the palette starts with the next time it opens (a pasted link). */
  paletteQuery: string;
  playerBarCollapsed: boolean;
  sidebarCollapsed: boolean;
  setQueueOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  openCommandPaletteWith: (query: string) => void;
  togglePlayerBarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const LAYOUT_STORAGE_KEY = "luftplayer.layout.v1";
const initialLayout = readLayoutPreferences();
let layoutPersistenceTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

export const useUiStore = create<UiStore>((set, get) => ({
  queueOpen: false,
  recentOpen: false,
  setRecentOpen: (recentOpen) => set({
    recentOpen,
    queueOpen: recentOpen ? false : get().queueOpen,
    commandPaletteOpen: recentOpen ? false : get().commandPaletteOpen,
  }),
  commandPaletteOpen: false,
  paletteQuery: "",
  playerBarCollapsed: initialLayout.playerBarCollapsed,
  sidebarCollapsed: initialLayout.sidebarCollapsed,
  setQueueOpen: (queueOpen) => set({
    queueOpen,
    recentOpen: queueOpen ? false : get().recentOpen,
    commandPaletteOpen: queueOpen ? false : get().commandPaletteOpen,
  }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({
    commandPaletteOpen,
    recentOpen: commandPaletteOpen ? false : get().recentOpen,
    queueOpen: commandPaletteOpen ? false : get().queueOpen,
    paletteQuery: commandPaletteOpen ? get().paletteQuery : "",
  }),
  openCommandPaletteWith: (paletteQuery) => set({
    paletteQuery,
    commandPaletteOpen: true,
    recentOpen: false,
    queueOpen: false,
  }),
  togglePlayerBarCollapsed: () => {
    const playerBarCollapsed = !get().playerBarCollapsed;
    set({ playerBarCollapsed });
    persistCurrentLayoutSoon();
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    persistLayoutPreferences({
      ...currentLayoutPreferences(),
      sidebarCollapsed,
    });
    set({ sidebarCollapsed });
  },
}));

interface LayoutPreferences {
  playerBarCollapsed: boolean;
  sidebarCollapsed: boolean;
}

function currentLayoutPreferences(): LayoutPreferences {
  const state = useUiStore.getState();
  return {
    playerBarCollapsed: state.playerBarCollapsed,
    sidebarCollapsed: state.sidebarCollapsed,
  };
}

function readLayoutPreferences(): LayoutPreferences {
  const fallback: LayoutPreferences = {
    playerBarCollapsed: false,
    sidebarCollapsed: prefersCompactSidebar(),
  };

  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }

    const value = parsed as Partial<LayoutPreferences>;
    return {
      playerBarCollapsed:
        typeof value.playerBarCollapsed === "boolean"
          ? value.playerBarCollapsed
          : fallback.playerBarCollapsed,
      sidebarCollapsed:
        typeof value.sidebarCollapsed === "boolean"
          ? value.sidebarCollapsed
          : fallback.sidebarCollapsed,
    };
  } catch {
    return fallback;
  }
}

function persistLayoutPreferences(value: LayoutPreferences): void {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Layout preferences are optional and must never block interaction.
  }
}

function persistCurrentLayoutSoon(): void {
  if (layoutPersistenceTimer !== undefined) {
    globalThis.clearTimeout(layoutPersistenceTimer);
  }
  layoutPersistenceTimer = globalThis.setTimeout(() => {
    layoutPersistenceTimer = undefined;
    persistLayoutPreferences(currentLayoutPreferences());
  }, 0);
}

function prefersCompactSidebar(): boolean {
  try {
    return window.matchMedia("(max-width: 1120px)").matches;
  } catch {
    return false;
  }
}
