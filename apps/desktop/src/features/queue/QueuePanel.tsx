import { X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useUiStore } from "../../stores/uiStore";
import { useListenRoomState } from "../listen-together/guestLock";
import { SharedQueuePanel } from "../listen-together/SharedQueuePanel";
import { t } from "../../i18n";
import { QueueCurrentItem } from "./QueueCurrentItem";
import { QueueFeedback } from "./QueueFeedback";
import { QueueUpcoming } from "./QueueUpcoming";
import { useQueueController } from "./useQueueController";
import { prefersLessMotion } from "../motion/motionLevel";

const FOCUSABLE =
  "button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";
const PANEL_EXIT_MS = 180;

export function QueuePanel() {
  const room = useListenRoomState((state) => state.status);
  const inRoom = Boolean(room?.roomId);
  const open = useUiStore((store) => store.queueOpen);
  const setOpen = useUiStore((store) => store.setQueueOpen);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(open);

  const controller = useQueueController(open && !inRoom, 2_500);
  const { connected, canRead, queue } = controller;
  const currentItem = queue.data?.currentItem;

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }

    if (!mounted) {
      return;
    }

    const reducedMotion = prefersLessMotion();
    const timeout = window.setTimeout(
      () => setMounted(false),
      reducedMotion ? 0 : PANEL_EXIT_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [mounted, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousBodyOverflow =
      document.body.style.overflow;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== "Tab" || !panel.current) {
        return;
      }

      const focusable = Array.from(
        panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        event.preventDefault();
        return;
      }

      if (
        event.shiftKey &&
        document.activeElement === first
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() =>
      closeButton.current?.focus(),
    );

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() =>
        previouslyFocused?.focus(),
      );
    };
  }, [open, setOpen]);

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  const motionClass = open ? "is-open" : "is-closing";

  const content = inRoom && room ? <SharedQueuePanel key={room.roomId} status={room} /> : !connected ? (
    <QueueFeedback kind="connecting" compact />
  ) : !canRead ? (
    <QueueFeedback kind="unavailable" compact />
  ) : queue.isPending && !queue.data ? (
    <QueueFeedback kind="loading" compact />
  ) : queue.isError && !queue.data ? (
    <QueueFeedback
      kind="error"
      compact
      onRetry={() => void queue.refetch()}
    />
  ) : (
    <>
      {currentItem && (
        <QueueCurrentItem
          item={currentItem}
          compact
        />
      )}
      <QueueUpcoming controller={controller} compact />
    </>
  );

  return createPortal(
    <div
      className={`queue-panel-backdrop ${motionClass}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setOpen(false);
        }
      }}
    >
      <aside
        id="queue-panel"
        ref={panel}
        className={`queue-panel ${motionClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="queue-panel-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="queue-panel-header">
          <div className="queue-panel-title">
            <h2 id="queue-panel-title">{inRoom ? t("listen.queueTitle") : t("queue.title")}</h2>
          </div>

          <div className="queue-header-actions">
            <button
              ref={closeButton}
              type="button"
              className="queue-panel-close"
              title={t("queue.close")}
              aria-label={t("queue.close")}
              onClick={() => setOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
        </header>

        <div
          className="queue-panel-scroll"
          data-wheel-volume="ignore"
          aria-busy={!inRoom && queue.isPending && !queue.data}
        >
          {content}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
