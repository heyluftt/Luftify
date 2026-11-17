import { create } from "zustand";

export interface OutgoingMessage { clientId: string; body: string; at: number; state: "sending" | "failed" }
interface ChatDraftState {
  drafts: Record<string, string>;
  outgoing: Record<string, OutgoingMessage[]>;
  draft: (key: string, body: string) => void;
  add: (key: string, message: OutgoingMessage) => void;
  status: (key: string, id: string, state: OutgoingMessage["state"]) => void;
  remove: (key: string, ids: string[]) => void;
  clear: () => void;
}
/** In memory only; drafts and failed sends survive page changes, never an account change. */
export const useChatDrafts = create<ChatDraftState>((set) => ({
  drafts: {}, outgoing: {},
  draft: (key, body) => set((state) => ({ drafts: { ...state.drafts, [key]: body } })),
  add: (key, message) => set((state) => ({ outgoing: { ...state.outgoing, [key]: [...(state.outgoing[key] ?? []), message] } })),
  status: (key, id, status) => set((state) => ({ outgoing: { ...state.outgoing, [key]: (state.outgoing[key] ?? []).map((message) => message.clientId === id ? { ...message, state: status } : message) } })),
  remove: (key, ids) => set((state) => ({ outgoing: { ...state.outgoing, [key]: (state.outgoing[key] ?? []).filter((message) => !ids.includes(message.clientId)) } })),
  clear: () => set({ drafts: {}, outgoing: {} }),
}));
