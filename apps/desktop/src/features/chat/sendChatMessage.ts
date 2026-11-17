import type { QueryClient } from "@tanstack/react-query";
import { chatApi, conversationKey, inboxKey, threadKey, type ChatAccount } from "./chatApi";
import { useChatDrafts, type OutgoingMessage } from "./chatDrafts";
import { mergeChatMessages, type ChatThreadData } from "./chatMessages";

export async function sendChatMessage(client: QueryClient, account: ChatAccount, peer: string, pending: OutgoingMessage) {
  const key = conversationKey(account, peer);
  useChatDrafts.getState().status(key, pending.clientId, "sending");
  try {
    const message = await chatApi.send(account, peer, pending.clientId, pending.body);
    // An old account's async completion must not recreate its cleared private cache.
    if (!useChatDrafts.getState().outgoing[key]?.some((entry) => entry.clientId === pending.clientId)) return;
    client.setQueryData<ChatThreadData>(threadKey(account, peer), (old) => old && ({ ...old, messages: mergeChatMessages(old.messages, [message]) }));
    useChatDrafts.getState().remove(key, [pending.clientId]);
    void client.invalidateQueries({ queryKey: inboxKey(account) });
  } catch { useChatDrafts.getState().status(key, pending.clientId, "failed"); }
}

/** Puts a text in the outbox and sends it; the thread shows it at once. */
export function queueChatMessage(client: QueryClient, account: ChatAccount, peer: string, body: string) {
  const pending: OutgoingMessage = { clientId: crypto.randomUUID(), body, at: Date.now(), state: "sending" };
  useChatDrafts.getState().add(conversationKey(account, peer), pending);
  void sendChatMessage(client, account, peer, pending);
}
