import { Gift, X } from "lucide-react";
import { t } from "../../i18n";
import { formatListeningTime } from "../analytics/analyticsFormatting";
import { markRecapSeen } from "./recapSeen";
import { useRecapStore } from "./recapStore";
import { useRecapCatalog } from "./useRecaps";

/** On the home page while a finished recap is new; gone once watched or dismissed. */
export function RecapHomeCard() {
  const { fresh } = useRecapCatalog();
  const open = useRecapStore((store) => store.open);
  const period = fresh[0];
  if (!period) return null;
  return (
    <section className="recap-home-card" data-kind={period.kind} aria-labelledby="recap-home-title">
      <span className="recap-home-icon" aria-hidden="true"><Gift size={22} /></span>
      <div className="recap-home-copy">
        <small>{t("recap.home.eyebrow")} · {period.eyebrow}</small>
        <h2 id="recap-home-title">{t("recap.home.title")}</h2>
        <p>{t("recap.home.body", { title: period.title, time: formatListeningTime(period.listeningMs) })}</p>
      </div>
      <div className="recap-home-actions">
        <button type="button" className="primary-button" onClick={() => open(period)}>{t("recap.home.watch")}</button>
        <button type="button" className="recap-home-dismiss" aria-label={t("recap.home.dismiss")} title={t("recap.home.dismiss")} onClick={() => markRecapSeen(period.id)}>
          <X size={16} />
        </button>
      </div>
    </section>
  );
}
