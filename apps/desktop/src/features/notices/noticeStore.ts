import { create } from "zustand";
import type { SocialRole } from "../friends/friendsTypes";

export type NoticeKind = "friend" | "invite" | "room" | "host" | "report" | "along" | "achievement" | "remote" | "playlist" | "chat";

/** Who a notice is about; the card then shows their picture. */
export interface NoticePerson {
  name: string;
  avatarUri?: string | null | undefined;
  roles?: SocialRole[] | undefined;
}

export interface AppNotice {
  /** Stable per event, so a repeat replaces instead of stacking. */
  id: string;
  kind: NoticeKind;
  title: string;
  action?: { label: string; to: string } | undefined;
  /** Stays until this time (invitations) instead of fading after a few seconds. */
  untilMs?: number | undefined;
  person?: NoticePerson | undefined;
}

/** A notice in the list under the bell. */
export interface NoticeEntry extends AppNotice {
  atMs: number;
  /** Taken care of elsewhere (a chat read in the conversation): no longer counts as new. */
  seen?: boolean | undefined;
}

const MAX_NOTICES = 4;
const MAX_HISTORY = 40;

interface NoticeState {
  /** The cards on screen. */
  notices: AppNotice[];
  /** Everything since start, newest first, also what "Do not disturb" kept quiet. */
  history: NoticeEntry[];
  readAtMs: number;
  /** `quiet` only adds it to the list. */
  push: (notice: AppNotice, options?: { quiet?: boolean }) => void;
  /** Closed by hand: the card goes, the list keeps it. */
  dismiss: (id: string) => void;
  dismissAll: () => void;
  /** The event is over (request withdrawn, invitation gone): card goes, the list keeps it without its link. */
  retire: (id: string) => void;
  /** The card goes and the list entry stops counting as new; it stays in the list. */
  acknowledge: (id: string) => void;
  markRead: () => void;
  clearHistory: () => void;
}

/** In-app notices; nothing here reaches Windows. */
export const useNotices = create<NoticeState>((set) => ({
  notices: [],
  history: [],
  readAtMs: 0,
  push: (notice, options) => set(({ notices, history }) => ({
    notices: options?.quiet ? notices : [...notices.filter((entry) => entry.id !== notice.id), notice].slice(-MAX_NOTICES),
    history: [{ ...notice, atMs: Date.now() }, ...history.filter((entry) => entry.id !== notice.id)].slice(0, MAX_HISTORY),
  })),
  dismiss: (id) => set(({ notices }) => ({ notices: notices.filter((entry) => entry.id !== id) })),
  dismissAll: () => set({ notices: [] }),
  retire: (id) => set(({ notices, history }) => ({
    notices: notices.filter((entry) => entry.id !== id),
    history: history.map((entry) => entry.id === id ? { ...entry, action: undefined, untilMs: undefined } : entry),
  })),
  acknowledge: (id) => set((state) => {
    const open = state.notices.some((entry) => entry.id === id);
    const fresh = state.history.some((entry) => entry.id === id && !entry.seen);
    if (!open && !fresh) return state;
    return {
      notices: state.notices.filter((entry) => entry.id !== id),
      history: state.history.map((entry) => entry.id === id ? { ...entry, seen: true } : entry),
    };
  }),
  markRead: () => set({ readAtMs: Date.now() }),
  clearHistory: () => set({ history: [] }),
}));

export const pushNotice = (notice: AppNotice, options?: { quiet?: boolean }) => useNotices.getState().push(notice, options);
export const dismissNotice = (id: string) => useNotices.getState().dismiss(id);
export const retireNotice = (id: string) => useNotices.getState().retire(id);
export const acknowledgeNotice = (id: string) => useNotices.getState().acknowledge(id);

export const unreadCount = (state: Pick<NoticeState, "history" | "readAtMs">) =>
  state.history.filter((entry) => entry.atMs > state.readAtMs && !entry.seen).length;
