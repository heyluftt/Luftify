import type { PlaylistDetails } from "@luft/protocol-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../../services/desktopApi";
import { canonicalPlaylistUri } from "../entities/playlistSnapshot";
import { usePlaylistUsage } from "../home/usePlaylistUsage";
import { useLikedLibrary, usePlaylistLibrary } from "../library/libraryQueries";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { warmPlaylists, warmupOrder, type WarmupProgress } from "./libraryWarmup";

const flagKey = (account: string) => `luftify.library-setup.v1.${account}`;
/** The first run prepares more and faster, while the screen explains the wait. */
const SETUP_PLAYLISTS = 25;
const SETUP_PAUSE_MS = 250;
/** Later starts refresh the favourites quietly, gently spaced. */
const BACKGROUND_PLAYLISTS = 15;
const BACKGROUND_PAUSE_MS = 1_500;
const BACKGROUND_DELAY_MS = 15_000;

function setUp(account: string): boolean {
  try { return window.localStorage.getItem(flagKey(account)) !== null; } catch { return true; }
}

function markSetUp(account: string) {
  try { window.localStorage.setItem(flagKey(account), String(Date.now())); } catch { /* the next start asks again */ }
}

export type SetupPhase = "idle" | "library" | "playlists" | "done";

/**
 * Prepares the library so playlists open and play without waiting. A new
 * account on this PC gets the setup screen; known ones are refreshed in the
 * background. Switching accounts starts over for the new one.
 */
export function useLibraryWarmup() {
  const client = useQueryClient();
  const { localReady } = usePlaybackEngine();
  const status = useQuery({ queryKey: ["librespot-status"], queryFn: desktopApi.librespotStatus, enabled: localReady, staleTime: 2_000 });
  const account = localReady ? status.data?.username ?? undefined : undefined;
  const library = usePlaylistLibrary(Boolean(account));
  const liked = useLikedLibrary();
  const usage = usePlaylistUsage(Boolean(account));
  const [visible, setVisible] = useState(false);
  /** Known whether this account gets the setup (first run) or a quiet refresh. */
  const [decided, setDecided] = useState(false);
  const [phase, setPhase] = useState<SetupPhase>("idle");
  const [progress, setProgress] = useState<WarmupProgress>({ done: 0, total: 0 });
  const started = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const items = library.view.data?.items;
  const libraryReady = Boolean(items) && !library.remote.isLoading;
  // Decided at the start, before this run fills the cache: had this PC seen the library before?
  const hadStoredLibrary = useRef<boolean | undefined>(undefined);
  if (hadStoredLibrary.current === undefined && library.cache.isFetched) {
    hadStoredLibrary.current = Boolean(library.cache.data?.items.length);
  }

  useEffect(() => {
    if (!account || started.current === account) return;
    if (!libraryReady || hadStoredLibrary.current === undefined || usage.isPending) return;
    started.current = account;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const firstRun = !setUp(account) && !hadStoredLibrary.current;
    if (!firstRun) markSetUp(account);
    if (firstRun) setVisible(true);
    setDecided(true);
    const store = (uri: string, snapshot: PlaylistDetails) => client.setQueryData(["playlist-snapshot-cache", canonicalPlaylistUri(uri)], snapshot);
    const run = async () => {
      if (firstRun) {
        setPhase("library");
        // Liked songs load alongside; their first pages are what the library shows.
        await liked.remote.refetch().catch(() => undefined);
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, BACKGROUND_DELAY_MS));
      }
      if (controller.signal.aborted) return;
      setPhase("playlists");
      const order = warmupOrder(items ?? [], usage.data ?? [], firstRun ? SETUP_PLAYLISTS : BACKGROUND_PLAYLISTS);
      await warmPlaylists(order, {
        signal: controller.signal,
        pauseMs: firstRun ? SETUP_PAUSE_MS : BACKGROUND_PAUSE_MS,
        onSnapshot: store,
        onProgress: firstRun ? setProgress : undefined,
      });
      if (controller.signal.aborted) return;
      markSetUp(account);
      setPhase("done");
      setVisible(false);
    };
    void run();
  }, [account, libraryReady, usage.isPending]);

  useEffect(() => () => abort.current?.abort(), []);

  /** Skipping keeps preparing in the background; only the screen goes. */
  const skip = () => {
    if (account) markSetUp(account);
    setVisible(false);
  };
  return { visible, decided, phase, progress, skip };
}
