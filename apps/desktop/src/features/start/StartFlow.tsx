import { LoaderCircle, LogIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SidebarBrandMark } from "../../components/sidebar/SidebarBrandMark";
import { t } from "../../i18n";
import { useStartFlow } from "./useStartFlow";
import { useSearchSlot, useStartSurface } from "./useStartSurface";

/**
 * The start of the app (DESIGN.md, "Aufbau"). One surface in two shapes: a
 * welcome card while no account is signed in, and a slim indicator in the
 * place of the search bar while the app builds up behind it.
 */
export function StartFlow() {
  const flow = useStartFlow();
  const active = flow.stage !== "done";
  useStartSurface(active && flow.ghost, flow.shown, flow.setupRows !== undefined);
  const slot = useSearchSlot(active);
  const signInButton = useRef<HTMLButtonElement>(null);
  const card = flow.stage === "welcome" || flow.stage === "signing";
  const later = useRef(flow.later);
  later.current = flow.later;

  useEffect(() => {
    if (!card) return;
    signInButton.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      later.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [card]);

  // Skipping the setup asks twice; without an answer the question goes away.
  const [asking, setAsking] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    if (asking === 0) return;
    const timer = window.setTimeout(() => setAsking(0), 6_000);
    return () => window.clearTimeout(timer);
  }, [asking]);
  const skip = () => {
    if (asking < 2) { setAsking(asking === 0 ? 1 : 2); return; }
    setAsking(0);
    flow.skip();
  };

  if (!active) return null;
  const form = card ? "card" : flow.stage === "pending" || flow.leaving ? "none" : "pill";

  return createPortal(
    <div className="start-layer" data-form={form} style={slot}>
      <section
        className="start-surface"
        role={card ? "dialog" : "status"}
        aria-modal={card || undefined}
        aria-labelledby={card ? "start-title" : undefined}
      >
        <div className="start-welcome" inert={!card}>
          <span className="start-mark"><SidebarBrandMark /></span>
          <h1 id="start-title">{t("start.welcome")}</h1>
          <p>{t("start.tagline")}</p>
          <button
            ref={signInButton}
            type="button"
            className="primary-button start-sign-in"
            disabled={flow.signing}
            onClick={flow.signIn}
          >
            {flow.signing ? <LoaderCircle className="is-spinning" size={17} /> : <LogIn size={17} />}
            {flow.signing ? t("start.signingIn") : t("start.signIn")}
          </button>
          {flow.failed && !flow.signing
            ? <small className="start-error" role="alert">{t("start.error")}</small>
            : <small>{t("start.hint")}</small>}
          <button type="button" className="text-button start-later" onClick={flow.later}>{t("start.later")}</button>
        </div>
        <div className="start-pill" aria-hidden={form !== "pill"}>
          <span className="start-mark"><SidebarBrandMark /></span>
          <strong>{flow.title}</strong>
          <span className="start-step" aria-live="polite">
            {flow.step}{flow.detail && <em> · {flow.detail}</em>}
          </span>
          <span className="start-percent">{Math.round(flow.progress * 100)} %</span>
        </div>
        <i className="start-fill" style={{ width: `${flow.progress * 100}%` }} aria-hidden="true" />
      </section>
      {flow.setupRows !== undefined && (
        // The first row is the liked songs; one more row per prepared playlist.
        <style>{`:root[data-start-setup] .sidebar-library-list > li:nth-child(n + ${flow.setupRows + 2}) { opacity: 0; transform: translateY(8px) scale(.9); }`}</style>
      )}
      {flow.canSkip && (
        <button type="button" className="text-button start-skip" title={t("start.skipTitle")} onClick={skip}>
          {t(asking === 0 ? "start.skip" : asking === 1 ? "start.skipSure" : "start.skipReally")}
        </button>
      )}
    </div>,
    document.body,
  );
}
