import { AudioLines, Headphones, MessageCircle, MessageSquareWarning, Trophy, UserPlus, Users } from "lucide-react";
import { t } from "../../i18n";
import type { NotificationSettings as Prefs } from "../../types/tauri";
import { managesRoles } from "../friends/roles";
import { useFriends } from "../friends/useFriends";
import { DEFAULT_NOTIFICATIONS } from "../notices/noticePrefs";
import { SectionHeading, SettingsGroup, ToggleRow } from "./SettingsPrimitives";

/** Which notices pop up; "Do not disturb" for friends still keeps all of them under the bell. */
export function NotificationSettings({ value, onChange }: { value: Prefs | undefined; onChange: (value: Prefs) => void }) {
  const prefs = { ...DEFAULT_NOTIFICATIONS, ...value };
  const luft = managesRoles(useFriends().data?.snapshot?.me);
  const toggle = (key: keyof Prefs) => (checked: boolean) => onChange({ ...prefs, [key]: checked });
  return (
    <section id="settings-notifications" className="settings-section">
      <SectionHeading index="08" title={t("settingsUi.nav.notifications")} />
      <SettingsGroup title={t("notice.settings.group")} description={t("notice.settings.groupHint")}>
        <div className="settings-list">
          <ToggleRow icon={MessageCircle} label={t("chat.notifications")} checked={prefs.messages !== false} onChange={toggle("messages")} />
          <ToggleRow icon={UserPlus} label={t("notice.settings.friends")} checked={prefs.friends} onChange={toggle("friends")} />
          <ToggleRow icon={Headphones} label={t("notice.settings.invites")} checked={prefs.invites} onChange={toggle("invites")} />
          <ToggleRow icon={Users} label={t("notice.settings.rooms")} checked={prefs.rooms} onChange={toggle("rooms")} />
          <ToggleRow icon={AudioLines} label={t("notice.settings.listenAlong")} checked={prefs.listenAlong} onChange={toggle("listenAlong")} />
          <ToggleRow icon={Trophy} label={t("notice.settings.achievements")} checked={prefs.achievements} onChange={toggle("achievements")} />
          {luft && <ToggleRow icon={MessageSquareWarning} label={t("notice.settings.reports")} checked={prefs.reports} onChange={toggle("reports")} />}
        </div>
      </SettingsGroup>
    </section>
  );
}
