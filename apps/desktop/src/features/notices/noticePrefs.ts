import type { NotificationSettings } from "../../types/tauri";
import type { NoticeKind } from "./noticeStore";

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  messages: true, friends: true, invites: true, rooms: true, listenAlong: true, achievements: true, reports: true,
};

const SETTING: Record<NoticeKind, keyof NotificationSettings> = {
  friend: "friends", invite: "invites", room: "rooms", host: "rooms", along: "listenAlong", achievement: "achievements", report: "reports", remote: "friends", playlist: "invites", chat: "messages",
};

/** Settings saved before this existed have none: everything shows. */
export const allowsNotice = (settings: NotificationSettings | undefined, kind: NoticeKind) =>
  settings?.[SETTING[kind]] !== false;
