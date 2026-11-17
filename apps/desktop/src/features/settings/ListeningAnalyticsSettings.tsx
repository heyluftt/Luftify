import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, ChevronRight, DatabaseZap, Trash2 } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n";
import { LISTENING_OVERVIEW_QUERY_KEY } from "../analytics/useListeningOverview";
import { desktopApi } from "../../services/desktopApi";
import { RECENTLY_PLAYED_QUERY_KEY } from "../recent/recentApi";

export function ListeningAnalyticsSettings({
  enabled,
  onEnabledChange,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const client = useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);
  const clear = useMutation({
    mutationFn: desktopApi.clearListeningAnalytics,
    onSuccess: async () => {
      setConfirmClear(false);
      client.setQueryData(RECENTLY_PLAYED_QUERY_KEY, []);
      await client.invalidateQueries({
        queryKey: [LISTENING_OVERVIEW_QUERY_KEY],
      });
    },
  });

  return (
    <div className="listening-analytics-settings">
      <div className="settings-list">
        <label className="setting-row">
          <span className="setting-icon"><BarChart3 aria-hidden="true" /></span>
          <span>
            <strong>{t("settings.analytics.enable")}</strong>
            <small>{t("settings.analytics.enableHint")}</small>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => onEnabledChange(event.currentTarget.checked)}
            />
            <span />
          </span>
        </label>
      </div>

      <div className="settings-analytics-actions">
        <a className="settings-analytics-link" href="#/insights">
          <span className="setting-icon"><DatabaseZap aria-hidden="true" /></span>
          <span>
            <strong>{t("settings.analytics.open")}</strong>
          </span>
          <ChevronRight aria-hidden="true" />
        </a>

        {!confirmClear ? (
          <button
            type="button"
            className="settings-analytics-clear"
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 aria-hidden="true" />
            <span>
              <strong>{t("settings.analytics.clear")}</strong>
            </span>
          </button>
        ) : (
          <div className="settings-analytics-confirmation" role="alert">
            <span>
              <strong>{t("settings.analytics.confirm")}</strong>
            </span>
            <div>
              <button
                type="button"
                className="text-button"
                disabled={clear.isPending}
                onClick={() => setConfirmClear(false)}
              >
                {t("close.cancel")}
              </button>
              <button
                type="button"
                className="secondary-button danger"
                disabled={clear.isPending}
                onClick={() => clear.mutate()}
              >
                {clear.isPending ? t("settings.analytics.clearing") : t("settings.analytics.clearNow")}
              </button>
            </div>
          </div>
        )}
      </div>

      {clear.isSuccess && (
        <p className="settings-analytics-status success" role="status">
          {t("settings.analytics.cleared")}
        </p>
      )}
      {clear.isError && (
        <p className="settings-analytics-status error" role="alert">
          {t("settings.analytics.clearError")}
        </p>
      )}
    </div>
  );
}
