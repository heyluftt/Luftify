import { MessageSquareWarning } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n";
import { useFriends } from "../friends/useFriends";
import { SettingsGroup } from "../settings/SettingsPrimitives";
import { canReport } from "./problemReportApi";
import { ProblemReportDialog } from "./ProblemReportDialog";

/** Only shown where the server would take the report. */
export function ProblemReportSettings() {
  const friends = useFriends();
  const [open, setOpen] = useState(false);
  const status = friends.data;
  if (!status || status.connection !== "online" || !canReport(status.snapshot)) return null;
  return <SettingsGroup title={t("report.group")}>
    <div className="settings-list">
      <div className="setting-row update-setting">
        <span className="setting-icon"><MessageSquareWarning /></span>
        <span><strong>{t("report.title")}</strong><small>{t("report.rowHint")}</small></span>
        <button type="button" className="secondary-button" onClick={() => setOpen(true)}>{t("report.open")}</button>
      </div>
    </div>
    {open && <ProblemReportDialog onClose={() => setOpen(false)} />}
  </SettingsGroup>;
}
