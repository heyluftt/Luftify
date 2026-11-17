import { t } from "../i18n";

export function PageLoadingState() {
  return (
    <div
      className="page page-loading-state"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{t("page.loading")}</span>
      <div className="page-loading-heading skeleton" />
      <div className="page-loading-hero skeleton" />
      <div className="page-loading-grid">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    </div>
  );
}
