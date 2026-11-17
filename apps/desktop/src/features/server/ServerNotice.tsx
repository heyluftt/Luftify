import { CloudOff } from "lucide-react";
import { t } from "../../i18n";

/**
 * The sync server behind friends, chat and listen-together rooms is switched
 * off for now. Set to `true` once it runs again; the notices then disappear.
 */
export const SERVER_AVAILABLE = false;

export function ServerNotice() {
  if (SERVER_AVAILABLE) return null;
  return (
    <p className="server-notice" role="status">
      <CloudOff size={16} aria-hidden="true" />
      {t("server.unavailable")}
    </p>
  );
}
