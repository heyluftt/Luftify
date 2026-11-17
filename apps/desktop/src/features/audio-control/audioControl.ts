import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";
import type { AudioControlSettings, Settings, VolumeCurve } from "../../types/tauri";
import {
  VOLUME_CONFIRMATION_TOLERANCE,
  volumeCoordinator,
  type MappedVolumeTarget,
} from "../playback/VolumeCommandCoordinator";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";

export const DEFAULT_AUDIO_CONTROL_SETTINGS: AudioControlSettings = {
  enabled: true,
  presets: [20, 40, 60, 80, 100],
  stepPercent: 5,
  wheelEnabled: true,
  restoreOnStart: true,
  rememberBeforeMute: true,
  showPercentage: true,
  curve: "linear",
  shortcutsEnabled: true,
  volumeUpShortcut: "Ctrl+ArrowUp",
  volumeDownShortcut: "Ctrl+ArrowDown",
  muteShortcut: "Ctrl+M",
  dsp: {
    enabled: false,
    presetId: "neutral",
    preampDb: 0,
    autoHeadroom: true,
    limiterEnabled: true,
    volumeBoostEnabled: false,
    volumeBoostDb: 3,
    bandsDb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    spatial: {
      enabled: false,
      presetId: "direct",
      mixPercent: 0,
      preDelayMs: 0,
      decaySeconds: 1.2,
      dampingPercent: 55,
      stereoWidthPercent: 100,
    },
  },
};

const LAST_VOLUME_KEY = "luft.audio-control.last-volume.v1";
let runtimeAudioControlSettings = DEFAULT_AUDIO_CONTROL_SETTINGS;

export function setRuntimeAudioControlSettings(settings: AudioControlSettings): void {
  runtimeAudioControlSettings = settings;
}

export function getRuntimeAudioControlSettings(): AudioControlSettings {
  return runtimeAudioControlSettings;
}

/** What the engine gets: every stage is off while the whole module is. */
export function effectiveDsp(settings: AudioControlSettings): AudioControlSettings["dsp"] {
  return {
    ...settings.dsp,
    enabled: settings.enabled && settings.dsp.enabled,
    volumeBoostEnabled: settings.enabled && settings.dsp.volumeBoostEnabled,
    spatial: {
      ...settings.dsp.spatial,
      enabled: settings.enabled && settings.dsp.spatial.enabled,
    },
  };
}

/** Applies DSP changes at once (runtime, cached settings, engine) and saves them. */
export async function applyDspSettings(client: QueryClient, next: AudioControlSettings): Promise<void> {
  setRuntimeAudioControlSettings(next);
  client.setQueryData<Settings>(["settings"], (current) => current
    ? { ...current, audioControl: next }
    : current);
  await desktopApi.previewDspSettings(effectiveDsp(next));
  await desktopApi.saveDspSettings(next.dsp);
}

export function useAudioControlSettings(): AudioControlSettings {
  const query = useAudioControlSettingsQuery();
  return query.data?.audioControl ?? DEFAULT_AUDIO_CONTROL_SETTINGS;
}

export function AudioControlSync() {
  const settingsQuery = useAudioControlSettingsQuery();
  const settings = settingsQuery.data?.audioControl ?? DEFAULT_AUDIO_CONTROL_SETTINGS;
  const { mockMode } = usePlaybackEngine();
  const connection = usePlayerStore((state) => state.connection);
  const confirmedVolume = usePlayerStore((state) => state.confirmed?.volume);
  const restored = useRef(false);
  const restoreResolved = useRef(false);
  const startupVolume = useRef(readLastVolume());
  useEffect(() => setRuntimeAudioControlSettings(settings), [settings]);
  useEffect(() => {
    volumeCoordinator.configure({
      nativeMuteAvailable: true,
      rememberBeforeMute: settings.rememberBeforeMute,
      adapter: mockMode ? "mock-provider" : "librespot",
      volumeEventAvailable: mockMode,
    });
  }, [mockMode, settings.rememberBeforeMute]);
  useEffect(() => {
    if (!settingsQuery.isSuccess || !restoreResolved.current) return;
    if (confirmedVolume !== undefined && confirmedVolume > 0) saveLastVolume(confirmedVolume);
  }, [confirmedVolume, settingsQuery.isSuccess]);
  useEffect(() => {
    if (
      restored.current
      || connection !== "online"
      || !settingsQuery.isSuccess
      || confirmedVolume === undefined
    ) return;
    restored.current = true;
    restoreResolved.current = true;
    const target = startupVolume.current;
    if (
      settings.enabled
      && settings.restoreOnStart
      && target !== undefined
      && Math.abs(target - confirmedVolume) > VOLUME_CONFIRMATION_TOLERANCE
    ) {
      volumeCoordinator.set(target);
      return;
    }
    if (confirmedVolume > 0) saveLastVolume(confirmedVolume);
  }, [connection, confirmedVolume, settings.enabled, settings.restoreOnStart, settingsQuery.isSuccess]);
  return null;
}

function useAudioControlSettingsQuery() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: desktopApi.settings,
    staleTime: 30_000,
  });
}

export function useVolumeDiagnostics() {
  return useSyncExternalStore(
    (listener) => volumeCoordinator.subscribe(listener),
    () => volumeCoordinator.getDiagnostics(),
    () => volumeCoordinator.getDiagnostics(),
  );
}

export function uiToSpotify(uiValue: number, curve: VolumeCurve): number {
  const normalized = clamp(uiValue);
  return curve === "perceptual" ? Math.sqrt(normalized) : normalized;
}

export function spotifyToUi(spotifyValue: number, curve: VolumeCurve): number {
  const normalized = clamp(spotifyValue);
  return curve === "perceptual" ? normalized * normalized : normalized;
}

export function mappedVolume(uiValue: number, curve: VolumeCurve): MappedVolumeTarget {
  const ui = clamp(uiValue);
  return { uiValue: ui, spotifyValue: uiToSpotify(ui, curve), curve };
}

export function setUiVolume(uiValue: number, curve: VolumeCurve, uiCreatedAtMs = Date.now()): void {
  volumeCoordinator.setMapped(mappedVolume(uiValue, curve), uiCreatedAtMs);
}

export function setAudioPreset(percent: number, curve: VolumeCurve): void {
  setUiVolume(percent / 100, curve);
}

export function shortcutMatches(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.at(-1);
  if (!key) return false;
  const expectedKey = key === "arrowup" ? "arrowup" : key === "arrowdown" ? "arrowdown" : key;
  return event.key.toLowerCase() === expectedKey
    && event.ctrlKey === parts.includes("ctrl")
    && event.altKey === parts.includes("alt")
    && event.shiftKey === parts.includes("shift");
}

function readLastVolume(): number | undefined {
  try {
    const stored = localStorage.getItem(LAST_VOLUME_KEY);
    if (stored === null) return undefined;
    const value = Number(stored);
    return Number.isFinite(value) && value > 0 && value <= 1 ? value : undefined;
  } catch {
    return undefined;
  }
}

function saveLastVolume(volume: number): void {
  try { localStorage.setItem(LAST_VOLUME_KEY, String(clamp(volume))); } catch { /* local storage is optional */ }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
