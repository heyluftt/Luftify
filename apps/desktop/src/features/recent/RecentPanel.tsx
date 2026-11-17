import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { t } from "../../i18n";
import { RecentContent } from "./RecentContent";

export function RecentPanel() {
  const open = useUiStore((state) => state.recentOpen);
  return open ? <OpenRecentPanel /> : null;
}

function OpenRecentPanel() {
  const panel = useRef<HTMLElement>(null);
  const close = useUiStore((state) => state.setRecentOpen);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(false); }
      if (event.key !== "Tab") return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex='0']",
      ) ?? []);
      const first = items[0];
      const last = items.at(-1);
      if (!panel.current?.contains(document.activeElement)) {
        event.preventDefault(); first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      const ui = useUiStore.getState();
      if (!ui.queueOpen && !ui.commandPaletteOpen && previous?.isConnected) previous.focus();
    };
  }, [close]);
  return createPortal(
    <div className="queue-panel-backdrop is-open" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close(false);
    }}>
      <aside id="recent-panel" ref={panel} className="queue-panel is-open" role="dialog"
        aria-modal="true" aria-labelledby="recent-panel-title">
        <header className="queue-panel-header">
          <div className="queue-panel-title"><h2 id="recent-panel-title">{t("recent.title")}</h2></div>
          <button className="queue-panel-close" type="button" aria-label={t("recent.close")}
            title={t("recent.close")} onClick={() => close(false)}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="queue-panel-scroll" data-wheel-volume="ignore">
          <RecentContent onNavigate={() => close(false)} />
        </div>
      </aside>
    </div>, document.body,
  );
}
