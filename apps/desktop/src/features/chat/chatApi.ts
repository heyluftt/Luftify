import { invoke } from "@tauri-apps/api/core";
import type { SocialProfile } from "../friends/friendsTypes";

export interface ChatAccount { serverUrl: string; profileId: string }
export interface ChatMessage { id: number; clientId: string; senderId: string; body: string; createdAtMs: number }
export interface ChatConversation { profile: SocialProfile; lastMessage: ChatMessage | null; lastIncoming?: ChatMessage | null; unread: number; /** How far the friend has read; older servers send nothing. */ peerRead?: number }
export interface ChatPage { messages: ChatMessage[]; hasMore: boolean }
export const chatApi = {
  inbox: (account: ChatAccount) => invoke<ChatConversation[]>("chat_inbox", { account }),
  messages: (account: ChatAccount, peer: string, cursor?: { before?: number; after?: number }) => invoke<ChatPage>("chat_messages", { account, peer, ...cursor }),
  send: (account: ChatAccount, peer: string, clientId: string, body: string) => invoke<ChatMessage>("chat_send", { account, peer, input: { clientId, body } }),
  read: (account: ChatAccount, peer: string, through: number) => invoke<{ through: number }>("chat_read", { account, peer, through }),
};
export const chatKey = (account: ChatAccount) => ["chat", account.serverUrl, account.profileId] as const;
export const inboxKey = (account: ChatAccount) => [...chatKey(account), "inbox"] as const;
export const threadKey = (account: ChatAccount, peer: string) => [...chatKey(account), "thread", peer] as const;
export const conversationKey = (account: ChatAccount, peer: string) => JSON.stringify([...chatKey(account), peer]);
