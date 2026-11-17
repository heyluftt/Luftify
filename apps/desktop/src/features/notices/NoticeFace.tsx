import { RoleAvatar } from "../friends/RoleBadge";
import { NOTICE_ICONS } from "./noticeIcons";
import type { AppNotice } from "./noticeStore";

/** The person's picture with a small kind symbol, or the symbol alone. */
export function NoticeFace({ notice }: { notice: AppNotice }) {
  const Icon = NOTICE_ICONS[notice.kind];
  if (!notice.person) return <span className="app-notice-icon" aria-hidden="true"><Icon size={17} /></span>;
  return <span className="app-notice-face" aria-hidden="true">
    <RoleAvatar name={notice.person.name} uri={notice.person.avatarUri} roles={notice.person.roles} size="sm" />
    <i><Icon size={10} /></i>
  </span>;
}
