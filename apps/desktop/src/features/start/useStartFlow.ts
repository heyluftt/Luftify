import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { preloadAllPages } from "../../pages/lazyPages";
import { usePlayerStore } from "../../stores/playerStore";
import { usePlaylistUsage } from "../home/usePlaylistUsage";
import { usePlaylistLibrary } from "../library/libraryQueries";
import { LIBRESPOT_STATUS_QUERY_KEY, usePlaybackEngine } from "../playback/usePlaybackEngine";
import { useLibraryWarmup } from "../setup/useLibraryWarmup";

/** The regions of the app, in the order they are built up. */
export const START_PARTS = ["nav", "library", "player", "main"] as const;
export type StartPart = (typeof START_PARTS)[number];
/** pending: nothing known yet · welcome/signing: no account · loading: building up. */
export type StartStage = "pending" | "welcome" | "signing" | "loading" | "done";

/** At least this long between two regions, so each one is seen arriving. */
const PART_GAP_MS = 340;
/** Time for the last region's entrance before the start hands over. */
const SETTLE_MS = 900;
/** A normal start never waits longer than this for slow or missing data. */
const BOOT_CAP_MS = 7_000;
/** After a sign-in the library needs longer the first time. */
const SIGNED_IN_CAP_MS = 25_000;
const PENDING_CAP_MS = 4_000;
const PLAYER_WAIT_MS = 2_500;

/**
 * Drives the start (DESIGN.md, "Aufbau"): the app lies there as an outline
 * and each region appears when its data has arrived. Without an account the
 * welcome asks for the Spotify sign-in first; the first start of an account
 * on this PC also waits for the library setup (useLibraryWarmup).
 */
export function useStartFlow() {
  const client = useQueryClient();
  const { localPhase, credentialsPresent, mockMode } = usePlaybackEngine();
  const warmup = useLibraryWarmup();
  const library = usePlaylistLibrary();
  const usage = usePlaylistUsage();
  const playbackKnown = usePlayerStore((store) => store.playback !== undefined);

  const [finished, setFinished] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [shown, setShown] = useState<StartPart[]>([]);
  const [pendingTooLong, setPendingTooLong] = useState(false);
  const [playerWaited, setPlayerWaited] = useState(false);
  const [capped, setCapped] = useState(false);
  const [pagesLoaded, setPagesLoaded] = useState(false);
  const lastReveal = useRef(0);

  const login = useMutation({
    mutationFn: desktopApi.startLibrespotLogin,
    onSuccess: (status) => {
      setSignedIn(true);
      client.setQueryData(LIBRESPOT_STATUS_QUERY_KEY, status);
      void client.invalidateQueries({ queryKey: ["librespot-accounts"] });
      void client.invalidateQueries({ queryKey: ["playback"] });
      void client.invalidateQueries({ queryKey: ["library"] });
    },
  });

  const statusKnown = mockMode || localPhase !== undefined || pendingTooLong;
  const needsLogin = !mockMode
    && localPhase !== undefined
    && !credentialsPresent
    && (localPhase === "needsLogin" || localPhase === "authenticating" || localPhase === "error");
  const signing = login.isPending || localPhase === "authenticating";
  // After the start, a new account on this PC (switch, or a sign-in in
  // Settings) still gets its setup: the indicator alone, over the open app.
  const late = finished && warmup.visible;
  const stage: StartStage = late ? "loading"
    : finished ? "done"
    : !statusKnown ? "pending"
    : needsLogin && !dismissed ? (signing ? "signing" : "welcome")
    : "loading";
  /** The app is still an outline that builds up. */
  const loading = stage === "loading" && !finished;

  // Every page is loaded behind the indicator, so the first click on any of
  // them opens at once.
  useEffect(() => { void preloadAllPages().then(() => setPagesLoaded(true)); }, []);

  useEffect(() => {
    if (stage !== "pending") return;
    const timer = window.setTimeout(() => setPendingTooLong(true), PENDING_CAP_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setPlayerWaited(true), PLAYER_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);

  // The setup may take as long as it needs (it can be skipped); everything
  // else gives up waiting after a while and shows what is there.
  useEffect(() => {
    if (!loading || warmup.visible) return;
    const timer = window.setTimeout(() => setCapped(true), signedIn && !warmup.decided ? SIGNED_IN_CAP_MS : BOOT_CAP_MS);
    return () => window.clearTimeout(timer);
  }, [loading, warmup.visible, warmup.decided, signedIn]);

  // On a PC without a stored library the list only counts once Spotify answered.
  const libraryReady = Boolean(library.view.data?.items) && !library.remote.isLoading;
  const setupSettled = mockMode || (warmup.decided && !warmup.visible);
  const ready: Record<StartPart, boolean> = {
    nav: true,
    library: libraryReady,
    player: playbackKnown || playerWaited,
    main: libraryReady && !usage.isPending && setupSettled && pagesLoaded,
  };
  const next = START_PARTS[shown.length];
  const nextReady = next ? ready[next] || (capped && !warmup.visible) : false;

  useEffect(() => {
    if (!loading) return;
    if (!next) {
      const timer = window.setTimeout(() => setFinished(true), SETTLE_MS);
      return () => window.clearTimeout(timer);
    }
    if (!nextReady) return;
    const wait = Math.max(0, PART_GAP_MS - (performance.now() - lastReveal.current));
    const timer = window.setTimeout(() => {
      lastReveal.current = performance.now();
      setShown((current) => current.includes(next) ? current : [...current, next]);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [loading, next, nextReady]);

  const setup = warmup.visible || signedIn;
  const share = warmup.progress.total > 0 ? warmup.progress.done / warmup.progress.total : 0;
  const progress = warmup.visible ? (warmup.phase === "playlists" ? .2 + share * .72 : .1)
    : next ? shown.length / START_PARTS.length
    : 1;
  const step = warmup.visible && warmup.phase === "playlists" && warmup.progress.total > 0
    ? t("start.step.playlist", { done: Math.min(warmup.progress.done + 1, warmup.progress.total), total: warmup.progress.total })
    : warmup.visible ? t("start.step.library")
    : next ? t(STEP_LABEL[next])
    : t("start.step.done");

  return {
    stage,
    /** The app behind is only its outline; false for a setup after the start. */
    ghost: !finished,
    shown,
    /** All regions are up; the indicator hands over to the search bar. */
    leaving: loading && !next,
    title: setup ? t("start.settingUp") : t("start.starting"),
    step,
    detail: warmup.visible && warmup.phase === "playlists" ? warmup.progress.current : undefined,
    progress,
    signing,
    failed: login.isError || localPhase === "error",
    signIn: () => login.mutate(),
    /** "Later": the app builds up without an account; Settings keeps the sign-in. */
    later: () => { setDismissed(true); setCapped(true); },
    canSkip: warmup.visible,
    /** During the setup the library rows appear one by one, as playlists get ready. */
    setupRows: warmup.visible && !finished ? (warmup.phase === "playlists" ? warmup.progress.done : 0) : undefined,
    skip: warmup.skip,
  };
}

const STEP_LABEL = {
  nav: "start.step.account",
  library: "start.step.library",
  player: "start.step.player",
  main: "start.step.home",
} as const;
