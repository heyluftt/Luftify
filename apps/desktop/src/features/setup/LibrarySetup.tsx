import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { useLibraryWarmup } from "./useLibraryWarmup";

/**
 * The first start with an account on this PC: Luftify prepares the library
 * while this screen shows how far it is. Skipping asks twice and keeps
 * preparing in the background.
 */
export function LibrarySetup() {
  const { visible, phase, progress, skip } = useLibraryWarmup();
  const [asking, setAsking] = useState<0 | 1 | 2>(0);
  const card = useRef<HTMLElement>(null);
  useEffect(() => { if (visible) card.current?.focus({ preventScroll: true }); }, [visible]);
  if (!visible) return null;
  const share = phase === "playlists" && progress.total > 0 ? progress.done / progress.total : 0;
  const percent = Math.round((phase === "library" ? .05 : .1 + share * .9) * 100);
  const line = phase === "library"
    ? t("setup.library")
    : progress.total > 0 ? t("setup.playlist", { done: Math.min(progress.done + 1, progress.total), total: progress.total }) : t("setup.library");
  return createPortal(<div className="library-setup-layer">
    <section ref={card} className="library-setup" role="dialog" aria-modal="true" aria-labelledby="library-setup-title" tabIndex={-1}>
      <div className="library-setup-orb" aria-hidden="true"><i /><i /><i /></div>
      <h2 id="library-setup-title">{t("setup.title")}</h2>
      <p>{t("setup.subtitle")}</p>
      <div className="library-setup-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("setup.title")}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <small className="library-setup-step" aria-live="polite">
        <span>{line}</span>{progress.current && phase === "playlists" && <strong>{progress.current}</strong>}
      </small>
      {asking === 0 && <button type="button" className="text-button" onClick={() => setAsking(1)}>{t("setup.skip")}</button>}
      {asking > 0 && <div className="library-setup-confirm" role="alertdialog" aria-label={t("setup.skip")}>
        <span>{t(asking === 1 ? "setup.skipSure" : "setup.skipReallySure")}</span>
        <div>
          <button type="button" className="secondary-button" onClick={() => setAsking(0)}>{t("setup.keepWaiting")}</button>
          <button type="button" className="primary-button" onClick={() => asking === 1 ? setAsking(2) : skip()}>
            {t(asking === 1 ? "setup.skipYes" : "setup.skipReallyYes")}
          </button>
        </div>
      </div>}
    </section>
  </div>, document.body);
}
