import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

const FULLSCREEN_ROOT_CLASS = "lyrics-fullscreen-active";

export interface LyricsFullscreenController {
  isFullscreen: boolean;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
  toggleFullscreen: () => Promise<void>;
}

export function useLyricsFullscreen(): LyricsFullscreenController {
  const [appWindow] = useState(() => getCurrentWindow());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);
  const operationRef = useRef(0);

  const updateFullscreenState = useCallback((fullscreen: boolean) => {
    isFullscreenRef.current = fullscreen;
    setIsFullscreen(fullscreen);
  }, []);

  const syncFullscreenState = useCallback(async () => {
    try {
      updateFullscreenState(await appWindow.isFullscreen());
    } catch {
      updateFullscreenState(false);
    }
  }, [appWindow, updateFullscreenState]);

  const setFullscreen = useCallback(
    async (fullscreen: boolean) => {
      const operation = ++operationRef.current;

      try {
        await appWindow.setFullscreen(fullscreen);
        const actualFullscreen = await appWindow.isFullscreen();
        if (operation === operationRef.current) {
          updateFullscreenState(actualFullscreen);
        }
      } catch {
        if (operation === operationRef.current) {
          await syncFullscreenState();
        }
      }
    },
    [appWindow, syncFullscreenState, updateFullscreenState],
  );

  const toggleFullscreen = useCallback(
    () => setFullscreen(!isFullscreenRef.current),
    [setFullscreen],
  );

  useEffect(() => {
    document.documentElement.classList.toggle(
      FULLSCREEN_ROOT_CLASS,
      isFullscreen,
    );

    return () => {
      document.documentElement.classList.remove(FULLSCREEN_ROOT_CLASS);
    };
  }, [isFullscreen]);

  useEffect(() => {
    let active = true;
    let unlistenResize: (() => void) | undefined;

    const syncIfActive = async () => {
      try {
        const fullscreen = await appWindow.isFullscreen();
        if (active) {
          updateFullscreenState(fullscreen);
        }
      } catch {
        if (active) {
          updateFullscreenState(false);
        }
      }
    };
    const syncOnFocus = () => {
      void syncIfActive();
    };
    const syncOnVisibilityChange = () => {
      if (document.visibilityState === "visible") syncOnFocus();
    };

    void syncIfActive();
    window.addEventListener("focus", syncOnFocus);
    document.addEventListener("visibilitychange", syncOnVisibilityChange);
    void appWindow
      .onResized(() => {
        void syncIfActive();
      })
      .then((unlisten) => {
        if (active) {
          unlistenResize = unlisten;
        } else {
          unlisten();
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unlistenResize?.();
      window.removeEventListener("focus", syncOnFocus);
      document.removeEventListener("visibilitychange", syncOnVisibilityChange);
      document.documentElement.classList.remove(FULLSCREEN_ROOT_CLASS);

      if (isFullscreenRef.current) {
        void appWindow.setFullscreen(false).catch(() => undefined);
      }
    };
  }, [appWindow, updateFullscreenState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F11") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }

      // Escape closes an open menu or dialog first, not the whole view.
      if (
        event.key === "Escape"
        && isFullscreenRef.current
        && !event.defaultPrevented
        && !hasOpenOverlay()
      ) {
        event.preventDefault();
        void setFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [setFullscreen, toggleFullscreen]);

  return {
    isFullscreen,
    setFullscreen,
    toggleFullscreen,
  };
}

/** A visible menu or modal dialog; hidden, pre-mounted ones do not count. */
function hasOpenOverlay(): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".track-actions-menu, [role='menu'], [aria-modal='true']"),
  ).some((element) => {
    const style = getComputedStyle(element);
    return style.visibility !== "hidden"
      && style.display !== "none"
      && Number(style.opacity) > 0
      && element.getClientRects().length > 0;
  });
}
