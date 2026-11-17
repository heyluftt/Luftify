import { AudioLines, Crown, Headphones, ListMusic, MessageCircle, MessageSquareWarning, Smartphone, Trophy, UserPlus, Users, type LucideIcon } from "lucide-react";
import type { NoticeKind } from "./noticeStore";

export const NOTICE_ICONS: Record<NoticeKind, LucideIcon> = {
  friend: UserPlus, invite: Headphones, room: Users, host: Crown, report: MessageSquareWarning, along: AudioLines, achievement: Trophy, remote: Smartphone, playlist: ListMusic, chat: MessageCircle,
};
