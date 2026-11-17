import { listen } from "@tauri-apps/api/event";
import { Hourglass } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../../i18n";

/**
 * Spotify hands out only so many audio keys for new songs per few minutes;
 * past that, Libre waits for a free slot (key_pacing.rs). Seconds until the
 * waiting song expects its key, while a load is in flight; otherwise null.
 */
export function useKeyWaitSeconds(loading: boolean): number | null {
  const [readyAtMs, setReadyAtMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ readyAtMs: number | null }>("player://key-wait", ({ payload }) => {
      setReadyAtMs(payload.readyAtMs);
      setNow(Date.now());
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const waiting = loading && readyAtMs !== null && readyAtMs > now;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [waiting]);

  return waiting ? Math.max(1, Math.ceil((readyAtMs - now) / 1_000)) : null;
}

export function KeyWaitNotice({ seconds }: { seconds: number }) {
  return (
    <span className="key-wait-notice" role="status" title={t("player.keyWaitHint")}>
      <Hourglass size={12} aria-hidden="true" />
      <span>{t("player.keyWait", { seconds })}</span>
    </span>
  );
}
