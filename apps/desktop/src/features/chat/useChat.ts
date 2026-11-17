import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useFriends } from "../friends/useFriends";
import { useRemoteDevices } from "../remote/remoteStore";
import { chatApi, chatKey, inboxKey, threadKey, conversationKey, type ChatAccount } from "./chatApi";
import { mergeChatMessages, type ChatThreadData } from "./chatMessages";
import { useChatDrafts } from "./chatDrafts";

/**
 * Open window: quick; minimised or in the tray: still notified, a lot less
 * often. With the live connection the server announces news itself
 * (ChatSync), so polling is only the safety net.
 */
const pace = (visibleMs: number) => () => {
  if (useRemoteDevices.getState().you) return PUSHED_FALLBACK_MS;
  return document.visibilityState === "visible" ? visibleMs : 15_000;
};
const PUSHED_FALLBACK_MS = 30_000;

export function useChatAccount() {
  const status = useFriends().data;
  const me = status?.snapshot?.me;
  const account = me && status ? { serverUrl: status.serverUrl, profileId: me.id } : undefined;
  return { account, online: status?.connection === "online", friends: status?.snapshot?.friends ?? [] };
}

/** Only ChatSync polls the inbox. All pages and navigation share this cache. */
export function useChatInbox(sync = false) {
  const { account, online } = useChatAccount();
  return useQuery({
    queryKey: account ? inboxKey(account) : ["chat-inactive"],
    queryFn: () => chatApi.inbox(account!), enabled: Boolean(account && online),
    refetchInterval: sync && online ? pace(4000) : false, refetchIntervalInBackground: true,
    staleTime: 3000, retry: false,
  });
}

export function useChatThread(account: ChatAccount, peer: string, online: boolean) {
  const client = useQueryClient();
  const key = threadKey(account, peer);
  const thread = useQuery({
    queryKey: key,
    queryFn: async (): Promise<ChatThreadData> => {
      const page = await chatApi.messages(account, peer);
      return { messages: page.messages, cursor: page.messages.at(-1)?.id ?? 0, hasOlder: page.hasMore };
    }, enabled: online, staleTime: Infinity, retry: false,
  });
  const updates = useQuery({
    queryKey: [...chatKey(account), "updates", peer],
    queryFn: () => chatApi.messages(account, peer, { after: client.getQueryData<ChatThreadData>(key)?.cursor ?? 0 }),
    enabled: online && Boolean(thread.data), refetchInterval: pace(2000), refetchIntervalInBackground: true, retry: false,
  });
  useEffect(() => {
    if (!updates.data?.messages.length) return;
    const page = updates.data;
    client.setQueryData<ChatThreadData>(key, (old) => old && ({ ...old, messages: mergeChatMessages(old.messages, page.messages), cursor: Math.max(old.cursor, page.messages.at(-1)?.id ?? 0) }));
  }, [updates.data, client, account.serverUrl, account.profileId, peer]);
  useEffect(() => {
    const ids = thread.data?.messages.map((message) => message.clientId) ?? [];
    const outbox = useChatDrafts.getState().outgoing[conversationKey(account, peer)];
    if (outbox?.some((message) => ids.includes(message.clientId))) useChatDrafts.getState().remove(conversationKey(account, peer), ids);
  }, [thread.data, account.serverUrl, account.profileId, peer]);
  return { thread, updates };
}
