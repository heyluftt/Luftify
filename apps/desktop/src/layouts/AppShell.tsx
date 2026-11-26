import { RecentPanel } from "../features/recent/RecentPanel";
import { Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { usePageEntering } from "../features/motion/usePageEntering";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { restoreScroll } from "./scrollRestore";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WindowTitleBar } from "../components/WindowTitleBar";
import { Sidebar } from "../components/Sidebar";
import { ContentErrorBoundary } from "../components/ContentErrorBoundary";
import { PageLoadingState } from "../components/PageLoadingState";
import { CloseConfirmDialog } from "../components/CloseConfirmDialog";
import { PlayerBar } from "../features/playback/PlayerBar";
import { CommandPalette } from "../features/command-palette/CommandPalette";
import { RecapStoryHost } from "../features/recap/RecapStoryHost";
import { QueuePanel } from "../features/queue/QueuePanel";
import { resyncPlayback } from "../features/playback/playbackEvents";
import { playbackCommands } from "../features/playback/playbackCommands";
import { usePlayerStore } from "../stores/playerStore";
import { useUiStore } from "../stores/uiStore";
import { desktopApi } from "../services/desktopApi";
import { dispatchTrayPlayerAction, type TrayPlayerAction } from "../features/playback/trayPlayerActions";
import { getRuntimeAudioControlSettings, setUiVolume, shortcutMatches, spotifyToUi, useAudioControlSettings } from "../features/audio-control/audioControl";
import { volumeCoordinator } from "../features/playback/VolumeCommandCoordinator";
import { PolarisSky } from "../features/theme/PolarisSky";
import { AbyssScene } from "../features/theme/abyss/AbyssScene";
import { AerisScene } from "../features/theme/aeris/AerisScene";
import { PixelpopScene } from "../features/theme/pixelpop/PixelpopScene";
import { ModularScene } from "../features/theme/modular/ModularScene";
import { RedlineEmbers } from "../features/theme/RedlineEmbers";
import { PrismaAtmosphere } from "../features/theme/PrismaAtmosphere";
import { RoseNocturne } from "../features/theme/RoseNocturne";
import { VioletNight } from "../features/theme/violet/VioletNight";
import { NoticeCenter } from "../features/notices/NoticeCenter";
import { themeArtworkRoute } from "../features/theme/themeArtworkRoute";
import { isInteractiveKeyboardTarget } from "./keyboardTargets";
import { StartFlow } from "../features/start/StartFlow";
import { useSpotifyLinkPaste } from "../features/links/useSpotifyLinkPaste";
import { t } from "../i18n";
import {
  applyNavigation,
  canNavigateBack,
  canNavigateForward,
  createNavigationHistory,
} from "./navigationHistory";

export function AppShell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const audioSettings = useAudioControlSettings();
  const [confirmClose, setConfirmClose] = useState(false);
  const playerBarCollapsed = useUiStore((store) => store.playerBarCollapsed);
  const sidebarCollapsed = useUiStore((store) => store.sidebarCollapsed);
  const setCommandPaletteOpen = useUiStore((store) => store.setCommandPaletteOpen);
  const setQueueOpen = useUiStore((store) => store.setQueueOpen);
  useSpotifyLinkPaste();
  const locationKey = `${location.pathname}${location.search}`;
  const pageEntering = usePageEntering(location.pathname);
  const historyRef = useRef(createNavigationHistory(locationKey));
  const scrollPositions = useRef(new Map<string, number>());
  // Updated during render, i.e. before the next page is committed.
  const activeRouteKey = useRef(locationKey);
  activeRouteKey.current = locationKey;
  const [historyNav, setHistoryNav] = useState({
    back: false,
    forward: false,
  });
  useEffect(() => {
    historyRef.current = applyNavigation(
      historyRef.current,
      locationKey,
      navigationType,
    );
    setHistoryNav({
      back: canNavigateBack(historyRef.current),
      forward: canNavigateForward(historyRef.current),
    });
  }, [locationKey, navigationType]);
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".page-scroll");
    if (!scroller) {
      return;
    }
    const key = locationKey;
    const stopRestore = navigationType === "POP"
      ? restoreScroll(scroller, scrollPositions.current.get(key) ?? 0)
      : (scroller.scrollTop = 0, () => undefined);
    // Saved while scrolling, not on leave: by the time this effect cleans
    // up, the next (often shorter) page is mounted and the browser has
    // already clamped scrollTop. `activeRouteKey` blocks that clamp from
    // being recorded for the page being left.
    const remember = () => {
      if (activeRouteKey.current === key) scrollPositions.current.set(key, scroller.scrollTop);
    };
    scroller.addEventListener("scroll", remember, { passive: true });
    return () => {
      stopRestore();
      scroller.removeEventListener("scroll", remember);
    };
  }, [locationKey, navigationType]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const runtimeAudioSettings = getRuntimeAudioControlSettings();
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, [contenteditable='true']") ?? false;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(!useUiStore.getState().commandPaletteOpen);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p" && !event.shiftKey) {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (useUiStore.getState().commandPaletteOpen) {
        return;
      }
      if (event.altKey && event.key === "ArrowLeft" && historyRef.current && canNavigateBack(historyRef.current)) {
        event.preventDefault();
        navigate(-1);
        return;
      }
      if (event.altKey && event.key === "ArrowRight" && historyRef.current && canNavigateForward(historyRef.current)) {
        event.preventDefault();
        navigate(1);
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "l") { event.preventDefault(); navigate("/library"); }
      if (event.ctrlKey && event.key.toLowerCase() === "q") {
        event.preventDefault();
        setQueueOpen(!useUiStore.getState().queueOpen);
        return;
      }
      if (event.ctrlKey && event.key === ",") { event.preventDefault(); navigate("/settings"); }
      if (!editing && event.key === "/" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        navigate("/search");
        return;
      }
      if (!editing && runtimeAudioSettings.enabled && runtimeAudioSettings.shortcutsEnabled) {
        const playback = usePlayerStore.getState().playback;
        const uiVolume = playback?.isMuted ? 0 : spotifyToUi(playback?.volume ?? 0, runtimeAudioSettings.curve);
        if (shortcutMatches(event, runtimeAudioSettings.volumeUpShortcut)) {
          event.preventDefault();
          setUiVolume(uiVolume + runtimeAudioSettings.stepPercent / 100, runtimeAudioSettings.curve);
          return;
        }
        if (shortcutMatches(event, runtimeAudioSettings.volumeDownShortcut)) {
          event.preventDefault();
          setUiVolume(uiVolume - runtimeAudioSettings.stepPercent / 100, runtimeAudioSettings.curve);
          return;
        }
        if (shortcutMatches(event, runtimeAudioSettings.muteShortcut)) {
          event.preventDefault();
          void volumeCoordinator.toggleMute();
          return;
        }
      }
      if (!editing && event.code === "Space" && !isInteractiveKeyboardTarget(event.target)) {
        event.preventDefault();
        const playback = usePlayerStore.getState().playback;
        if (playback) {
          playbackCommands.send({
            command: playback.isPlaying ? "pause" : "play",
          });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audioSettings, navigate, setCommandPaletteOpen, setQueueOpen]);
  useEffect(() => {
    let disposed = false;
    let unlisteners: UnlistenFn[] = [];
    void Promise.allSettled([
      listen<TrayPlayerAction>("tray://player-action", ({ payload }) => dispatchTrayPlayerAction(payload)),
      listen<string>("app://navigate", ({ payload }) => navigate(payload)),
      listen("app://confirm-close", () => setConfirmClose(true)),
      listen("tray://reconnect", () => {
        usePlayerStore.getState().setConnection("connecting");
        void resyncPlayback("tray-reconnect");
      }),
    ]).then((results) => {
      const listeners = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []);
      if (disposed) listeners.forEach((unlisten) => unlisten());
      else unlisteners = listeners;
    });
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [navigate]);
  const answerClose = useCallback((action: "exit" | "tray" | "cancel", remember: boolean) => {
    setConfirmClose(false);
    void (async () => {
      // "Don't ask again" becomes the close setting before the window goes.
      if (remember && action !== "cancel") {
        try {
          const settings = await desktopApi.settings();
          const closeBehavior = action === "exit" ? "exit" : "minimizeToTray";
          await desktopApi.saveSettings({ ...settings, closeBehavior });
          queryClient.setQueryData(["settings"], { ...settings, closeBehavior });
        } catch {
          // Closing must still happen when saving fails.
        }
      }
      await desktopApi.respondClosePrompt(action);
    })();
  }, [queryClient]);
  return (
    <div
      className={`app-frame${sidebarCollapsed ? " sidebar-collapsed" : ""}${playerBarCollapsed ? " playerbar-collapsed" : ""}`}
      data-theme-art={themeArtworkRoute(location.pathname)}
    >
      <PolarisSky />
      <RedlineEmbers />
      <PrismaAtmosphere />
      <RoseNocturne />
      <AbyssScene />
      <AerisScene />
      <PixelpopScene />
      <ModularScene />
      <VioletNight />
      <WindowTitleBar />
      <Sidebar />
      <div className="content-shell">
        <div className={location.pathname === "/search" ? "topbar search-route" : "topbar"}>
          <div className="topbar-history" aria-label={t("nav.history")}>
            <button type="button" aria-label={t("nav.back")} title={t("nav.back")} disabled={!historyNav.back} onClick={() => navigate(-1)}><ArrowLeft size={17} /></button>
            <button type="button" aria-label={t("nav.forward")} title={t("nav.forward")} disabled={!historyNav.forward} onClick={() => navigate(1)}><ArrowRight size={17} /></button>
          </div>
          <button
            type="button"
            className={location.pathname === "/search" ? "global-search is-compact" : "global-search"}
            onClick={() => setCommandPaletteOpen(true)}
          >
            <Search size={17} />
            <span>{location.pathname === "/search" ? t("command.short") : t("command.searchOrRun")}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="topbar-balance"><NoticeCenter /></div>
        </div>
        <main className="page-scroll" data-entering={pageEntering || undefined}>
          <ContentErrorBoundary key={location.pathname}>
            <Suspense fallback={<PageLoadingState />}>
              <Outlet />
            </Suspense>
          </ContentErrorBoundary>
        </main>
      </div>
      <PlayerBar />
      <QueuePanel />
      <RecentPanel />
      <CommandPalette />
      <RecapStoryHost />
      <StartFlow />
      {confirmClose && <CloseConfirmDialog onAnswer={answerClose} />}
    </div>
  );
}
