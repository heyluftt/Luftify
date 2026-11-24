import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface SetupInfo {
  version: string;
  sizeMb: number;
  folder: string;
  installed: boolean;
  preview: boolean;
}

interface Backend {
  info(): Promise<SetupInfo>;
  pickFolder(current: string): Promise<string | null>;
  install(folder: string): Promise<void>;
  launch(folder: string): Promise<void>;
  classic(): Promise<void>;
  close(): void;
  minimize(): void;
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const native: Backend = {
  info: () => invoke("info"),
  pickFolder: (current) => invoke("pick_folder", { current }),
  install: (folder) => invoke("install", { folder }),
  launch: (folder) => invoke("launch", { folder }),
  classic: () => invoke("classic"),
  close: () => void getCurrentWindow().close(),
  minimize: () => void getCurrentWindow().minimize(),
};

// In a plain browser (vite dev) nothing is installed, the window only plays.
const browser: Backend = {
  info: async () => ({ version: "0.0.0", sizeMb: 10, folder: "C:\Users\you\AppData\Local\Luftify", installed: false, preview: true }),
  pickFolder: async () => null,
  install: () => wait(4_000),
  launch: async () => undefined,
  classic: async () => undefined,
  close: () => undefined,
  minimize: () => undefined,
};

export const backend = isTauri() ? native : browser;
