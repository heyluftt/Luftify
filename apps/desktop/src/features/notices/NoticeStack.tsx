import { t } from "../../i18n";
import { CrashPrompt } from "../problem-report/CrashPrompt";
import { UpdateNotice } from "../updates/UpdateNotice";
import { AnnouncementNotice } from "./AnnouncementNotice";
import { NoticeCard } from "./NoticeCard";
import { useNotices } from "./noticeStore";
import { useNoticeWatchers } from "./useNoticeWatchers";

/** Bottom right above the player: the update card and short in-app notices. */
export function NoticeStack() {
  useNoticeWatchers();
  const notices = useNotices((state) => state.notices);
  const dismissAll = useNotices((state) => state.dismissAll);
  return <div className="app-notices">
    {notices.length > 1 && <button type="button" className="app-notices-clear" onClick={dismissAll}>{t("notice.closeAll")}</button>}
    {notices.map((notice) => <NoticeCard key={notice.id} notice={notice} />)}
    <AnnouncementNotice />
    <CrashPrompt />
    <UpdateNotice />
  </div>;
}
