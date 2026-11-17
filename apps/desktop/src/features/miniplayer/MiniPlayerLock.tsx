import { listen } from "@tauri-apps/api/event";
import { Lock, LockOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";

const INTRO_MS = 7_000;
const RING = 2 * Math.PI * 15;
/** A little around the lock counts too, so a game's pointer need not be exact. */
const ZONE_PADDING = 6;

/**
 * Shown while the player is click-through. The window gets no mouse input
 * then, so the app watches the pointer: resting it on this lock for two
 * seconds (the ring fills) makes the player usable again. No click is
 * needed, so nothing reaches the game underneath.
 */
export function MiniPlayerLock() {
  const zone = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [intro, setIntro] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(false), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<number>("miniplayer://unlock-progress", (event) => setProgress(event.payload))
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Tell the app where the lock is; it follows scale and window size.
  useEffect(() => {
    const node = zone.current;
    if (!node) return;
    const report = () => {
      const rect = node.getBoundingClientRect();
      void desktopApi.setMiniplayerUnlockZone({
        x: rect.left - ZONE_PADDING,
        y: rect.top - ZONE_PADDING,
        width: rect.width + ZONE_PADDING * 2,
        height: rect.height + ZONE_PADDING * 2,
        scale: window.devicePixelRatio || 1,
      }).catch(() => undefined);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(document.documentElement);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      void desktopApi.setMiniplayerUnlockZone(null).catch(() => undefined);
    };
  }, []);

  const unlocking = progress > 0;
  return (
    <>
      {(intro || unlocking) && (
        <span className={unlocking ? "miniplayer-lock-hint is-unlocking" : "miniplayer-lock-hint"} aria-hidden="true">
          {unlocking ? t("miniplayerUi.unlocking") : t("miniplayerUi.unlockHint")}
        </span>
      )}
      <div
        ref={zone}
        className={unlocking ? "miniplayer-lock is-unlocking" : "miniplayer-lock"}
        role="status"
        aria-label={t("miniplayerUi.lockLabel")}
      >
        <svg className="miniplayer-lock-progress" viewBox="0 0 36 36" aria-hidden="true">
          <circle className="miniplayer-lock-track" cx="18" cy="18" r="15" />
          {unlocking && (
            <circle
              className="miniplayer-lock-ring"
              cx="18"
              cy="18"
              r="15"
              strokeDasharray={`${RING * progress} ${RING}`}
            />
          )}
        </svg>
        {progress >= 0.85 ? <LockOpen size={13} aria-hidden="true" /> : <Lock size={13} aria-hidden="true" />}
      </div>
    </>
  );
}
