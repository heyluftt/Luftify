import { ArrowDownToLine, History, RefreshCw } from "lucide-react";
import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { t, type MessageKey } from "../../i18n";
import { SettingsGroup } from "../settings/SettingsPrimitives";
import { ReleaseHistoryDialog } from "./ReleaseHistoryDialog";
import { openUpdatePage, progressPercent, updateErrorKey, useAppUpdate } from "./useAppUpdate";

/** Current version, a manual check and the install button. */
export function UpdateSettings() {
  const { query, install, progress } = useAppUpdate();
  const [history, setHistory] = useState(false);
  if (!isTauri()) return null;
  const info = query.data;
  const percent = progressPercent(progress);
  const status = install.isPending
    ? percent === 100 ? t("update.restarting") : t("update.downloading", { n: percent ?? 0 })
    : install.isError ? t(updateErrorKey(install.error) as MessageKey)
    : query.isFetching ? t("update.checking")
    : query.isError ? t(updateErrorKey(query.error) as MessageKey)
    : info?.version ? t("update.available", { version: info.version })
    : info ? t("update.current")
    : t("update.never");
  return <SettingsGroup title={t("update.title")}>
    <div className="settings-list">
      <div className="setting-row update-setting">
        <span className="setting-icon"><ArrowDownToLine /></span>
        <span>
          <strong>{info ? t("update.version", { version: info.currentVersion }) : t("update.title")}</strong>
          <small role="status">{status}</small>
        </span>
        {info?.version && info.manual
          ? <button type="button" className="primary-button" onClick={() => void openUpdatePage()}>{t("update.download")}</button>
          : info?.version
          ? <button type="button" className="primary-button" disabled={install.isPending} onClick={() => install.mutate()}>{t("update.install")}</button>
          : <button type="button" className="secondary-button" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw size={15} aria-hidden="true" />{t("update.check")}
          </button>}
      </div>
      <div className="setting-row update-setting">
        <span className="setting-icon"><History /></span>
        <span><strong>{t("update.history")}</strong><small>{t("update.historyHint")}</small></span>
        <button type="button" className="secondary-button" onClick={() => setHistory(true)}>{t("update.historyOpen")}</button>
      </div>
    </div>
    {history && <ReleaseHistoryDialog onClose={() => setHistory(false)} />}
  </SettingsGroup>;
}
