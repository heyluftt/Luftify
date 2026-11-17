import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Headphones, LoaderCircle, LogIn, Radio, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { usePlaybackEngine, LIBRESPOT_STATUS_QUERY_KEY } from "../playback/usePlaybackEngine";
import { FirstRunFriends } from "./FirstRunFriends";

const FOCUSABLE = "button:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Libre needs a Spotify Premium login before anything plays. The dialog
 * appears while no credentials are stored and can be put off for the
 * session; Settings keeps the same sign-in afterwards. After the first
 * sign-in the friends step follows in the same dialog (it skips itself when
 * a profile exists).
 */
export function FirstRunLibreLogin() {
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLElement>(null);
  const signInButton = useRef<HTMLButtonElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [friendsStep, setFriendsStep] = useState(false);
  const closeFriends = useCallback(() => setFriendsStep(false), []);
  const { localPhase, credentialsPresent, mockMode } = usePlaybackEngine();
  const needsLogin = !mockMode
    && !dismissed
    && localPhase !== undefined
    && !credentialsPresent
    && (localPhase === "needsLogin" || localPhase === "authenticating" || localPhase === "error");
  const login = useMutation({
    mutationFn: desktopApi.startLibrespotLogin,
    onSuccess: (status) => {
      setFriendsStep(true);
      queryClient.setQueryData(LIBRESPOT_STATUS_QUERY_KEY, status);
      void queryClient.invalidateQueries({ queryKey: ["librespot-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["playback"] });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  const open = needsLogin || friendsStep;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => signInButton.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        if (friendsStep) setFriendsStep(false);
        else setDismissed(true);
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
      window.requestAnimationFrame(() => previousFocus?.focus());
    };
  }, [open, friendsStep]);

  if (!open) return null;
  const signingIn = login.isPending || localPhase === "authenticating";

  return (
    <div className="first-run-backdrop">
      <section
        ref={dialog}
        className="first-run-choice"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-title"
        aria-describedby="first-run-description"
      >
        <span className="first-run-orbit" aria-hidden="true"><i /></span>
        {friendsStep ? <FirstRunFriends onDone={closeFriends} /> : <>
        <header className="first-run-heading">
          <span className="first-run-mark"><Sparkles size={16} /></span>
          <span className="first-run-eyebrow">{t("firstRun.eyebrow")}</span>
          <h1 id="first-run-title">{t("firstRun.title")}</h1>
          <p id="first-run-description">{t("firstRun.description")}</p>
        </header>

        <div className="first-run-engine-grid is-single">
          <div className="first-run-engine-card is-selected">
            <span className="first-run-engine-topline">
              <span className="first-run-engine-icon"><Radio /></span>
              <span className="first-run-detection is-ready">{t("firstRun.libreReady")}</span>
            </span>
            <span className="first-run-engine-copy">
              <strong>{t("firstRun.libreTitle")}</strong>
              <small>{t("firstRun.libreBody")}</small>
            </span>
            <span className="first-run-engine-facts">
              <span><Check /> {t("firstRun.libreFactOne")}</span>
              <span><Check /> {t("firstRun.libreFactTwo")}</span>
            </span>
          </div>
        </div>

        <div className="first-run-confirmation has-selection">
          <span>
            <strong>{t("firstRun.signInTitle")}</strong>
            <small>{t("firstRun.signInHint")}</small>
          </span>
          <button
            ref={signInButton}
            type="button"
            disabled={signingIn}
            onClick={() => login.mutate()}
          >
            {signingIn ? <LoaderCircle className="is-spinning" /> : <LogIn />}
            {signingIn ? t("firstRun.loggingIn") : t("firstRun.signIn")}
          </button>
        </div>

        {(login.isError || localPhase === "error") && (
          <p className="first-run-error" role="alert">{firstRunErrorMessage(login.error)}</p>
        )}
        <footer>
          <Headphones /> {t("firstRun.footer")}
          <button type="button" className="first-run-later" onClick={() => setDismissed(true)}>
            {t("firstRun.later")}
          </button>
        </footer>
        </>}
      </section>
    </div>
  );
}

function firstRunErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return t("firstRun.error");
}
