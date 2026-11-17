import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/** `manual`: found on the release page, to download by hand instead of installing here. */
export interface UpdateInfo { currentVersion: string; version: string | null; notes: string | null; notesEn?: string | null; date: string | null; manual?: boolean }
export interface UpdateProgress { downloaded: number; total: number | null }

// A tiny JSON file: often enough that a release reaches running apps the
// same hour, and again when Luftify comes back to the front.
const CHECK_EVERY_MS = 60 * 60_000;
const RECHECK_ON_FOCUS_AFTER_MS = 30 * 60_000;
export const UPDATE_QUERY_KEY = ["app-update"] as const;

/**
 * The newest version on the Luftify server, or without it on the release page. `auto` checks by itself (not in
 * development builds, and only a while after start); otherwise only on demand.
 */
export function useAppUpdate(auto = false) {
  const [ready, setReady] = useState(!auto);
  useEffect(() => {
    if (!auto || import.meta.env.DEV) return;
    const timer = window.setTimeout(() => setReady(true), 20_000);
    return () => window.clearTimeout(timer);
  }, [auto]);
  const query = useQuery({
    queryKey: UPDATE_QUERY_KEY,
    queryFn: () => invoke<UpdateInfo>("app_update_check"),
    enabled: isTauri() && ready,
    staleTime: RECHECK_ON_FOCUS_AFTER_MS,
    refetchInterval: auto ? CHECK_EVERY_MS : false,
    refetchOnWindowFocus: auto,
    // Luftify can live in the tray for days; it still has to notice updates.
    refetchIntervalInBackground: auto,
    retry: false,
  });
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const install = useMutation({
    mutationFn: async () => {
      setProgress({ downloaded: 0, total: null });
      const stop = await listen<UpdateProgress>("update://progress", (event) => setProgress(event.payload));
      try {
        await invoke("app_update_install");
      } finally {
        stop();
      }
    },
    onError: () => setProgress(null),
  });
  return { query, install, progress };
}

/** Opens the page where a `manual` update is downloaded. */
export const openUpdatePage = () => invoke("app_update_open_page");

export function updateErrorKey(error: unknown): string {
  const message = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  return message.startsWith("update.error.") ? message : "update.error.check";
}

export const progressPercent = (progress: UpdateProgress | null) =>
  progress?.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null;
