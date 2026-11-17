import { PanelBottomClose, Power, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";

type CloseAction = "exit" | "tray" | "cancel";

interface CloseConfirmDialogProps {
  /** `remember` asks to stop asking and keep this answer. */
  onAnswer: (action: CloseAction, remember: boolean) => void;
}

const FOCUSABLE =
  "button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function CloseConfirmDialog({ onAnswer }: CloseConfirmDialogProps) {
  const dialog = useRef<HTMLElement>(null);
  const trayButton = useRef<HTMLButtonElement>(null);
  const [remember, setRemember] = useState(false);
  const answer = useRef(onAnswer);
  answer.current = onAnswer;

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousBodyOverflow = document.body.style.overflow;
    // The harmless choice has focus: Enter keeps the music running.
    const focusFrame = window.requestAnimationFrame(() =>
      trayButton.current?.focus(),
    );

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        answer.current("cancel", false);
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;

      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, []);

  return (
    <div
      className="close-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onAnswer("cancel", false);
      }}
    >
      <section
        ref={dialog}
        className="close-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-confirm-title"
      >
        <header className="close-confirm-header">
          <h2 id="close-confirm-title">{t("close.title")}</h2>
          <button
            type="button"
            className="close-confirm-cancel"
            aria-label={t("close.cancel")}
            title={t("close.cancel")}
            onClick={() => onAnswer("cancel", false)}
          >
            <X size={16} />
          </button>
        </header>
        <div className="close-confirm-options">
          <button
            ref={trayButton}
            type="button"
            className="close-confirm-option"
            onClick={() => onAnswer("tray", remember)}
          >
            <PanelBottomClose size={20} aria-hidden="true" />
            <strong>{t("close.tray")}</strong>
          </button>
          <button
            type="button"
            className="close-confirm-option is-exit"
            onClick={() => onAnswer("exit", remember)}
          >
            <Power size={20} aria-hidden="true" />
            <strong>{t("close.exit")}</strong>
          </button>
        </div>
        <label className="close-confirm-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />
          <span>{t("close.remember")}</span>
        </label>
      </section>
    </div>
  );
}
