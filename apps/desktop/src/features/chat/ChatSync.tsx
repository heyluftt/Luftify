import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { useFriends } from "../friends/useFriends";
import { allowsNotice } from "../notices/noticePrefs";
import { acknowledgeNotice, dismissNotice, pushNotice, retireNotice, useNotices } from "../notices/noticeStore";
import { chatKey, inboxKey, threadKey, type ChatAccount, type ChatMessage } from "./chatApi";
import { mergeChatMessages, type ChatThreadData } from "./chatMessages";
import { useChatAccount, useChatInbox } from "./useChat";
import { useChatDrafts } from "./chatDrafts";
import { useChatVisible } from "./useChatRead";

export function ChatSync() {
  const client = useQueryClient();
  const { account, online } = useChatAccount();
  const inbox = useChatInbox(true);
  const settings = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings });
  const quiet = useFriends().data?.snapshot?.options.presenceMode === "busy";
  const path = useLocation().pathname;
  const visible = useChatVisible();
  const scope = account ? JSON.stringify([account.serverUrl, account.profileId]) : "";
  const previous = useRef<{ scope: string; last: Map<string, number> }>({ scope: "", last: new Map() });
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    useChatDrafts.getState().clear();
    client.removeQueries({ predicate: (query) => query.queryKey[0] === "chat" && JSON.stringify(query.queryKey.slice(1, 3)) !== scope });
    useNotices.setState((state) => ({ notices: state.notices.filter((entry) => entry.kind !== "chat"), history: state.history.filter((entry) => entry.kind !== "chat") }));
  }, [scope, client]);
  // The server announces a changed conversation over the live connection: fetch it now.
  useEffect(() => {
    if (!account) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<{ peer: string }>("friends://chat-changed", (event) => {
      void client.invalidateQueries({ queryKey: inboxKey(account) });
      void client.invalidateQueries({ queryKey: [...chatKey(account), "updates", event.payload.peer] });
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => undefined);
    return () => { disposed = true; stop?.(); };
  }, [scope, client]);
  useEffect(() => {
    if (!online || !inbox.data || !account) return;
    const baseline = previous.current.scope !== scope;
    const next = new Map<string, number>();
    for (const chat of inbox.data) {
      const id = `chat:${scope}:${chat.profile.id}`;
      const message = chat.lastIncoming;
      next.set(chat.profile.id, message?.id ?? 0);
      showInThread(client, account, chat.profile.id, [chat.lastIncoming, chat.lastMessage]);
      // Read in the conversation: the bell stops counting it as new.
      if (!chat.unread) { acknowledgeNotice(id); continue; }
      if (!allowsNotice(settings.data?.notifications, "chat") || (visible && path === `/messages/${chat.profile.id}`)) { dismissNotice(id); continue; }
      if (baseline || !message || message.senderId === account.profileId || message.id <= (previous.current.last.get(chat.profile.id) ?? 0)) continue;
      if (settings.data && allowsNotice(settings.data.notifications, "chat")) pushNotice({
        id, kind: "chat", title: t("chat.notice", { name: chat.profile.displayName, text: message.body.replace(/\s+/g, " ").slice(0, 100) }),
        person: { name: chat.profile.displayName, avatarUri: chat.profile.avatarUri, roles: chat.profile.roles },
        action: { label: t("chat.open"), to: `/messages/${chat.profile.id}` },
      }, { quiet });
    }
    // Removed or blocked friends also disappear from pending chat notifications.
    for (const peer of previous.current.last.keys()) if (!next.has(peer)) retireNotice(`chat:${scope}:${peer}`);
    previous.current = { scope, last: next };
  }, [inbox.data, online, scope, account?.profileId, settings.data, path, visible, quiet]);
  return null;
}

/**
 * The inbox already carries the newest message: a conversation that is
 * loaded shows it right away instead of after its own next poll. The thread's
 * cursor stays, so anything in between still arrives with that poll.
 */
function showInThread(client: QueryClient, account: ChatAccount, peer: string, latest: (ChatMessage | null | undefined)[]) {
  const key = threadKey(account, peer);
  const thread = client.getQueryData<ChatThreadData>(key);
  if (!thread) return;
  const newest = thread.messages.at(-1)?.id ?? 0;
  const fresh = latest.filter((message): message is ChatMessage => Boolean(message && message.id > newest));
  if (!fresh.length) return;
  client.setQueryData<ChatThreadData>(key, (old) => old && ({ ...old, messages: mergeChatMessages(old.messages, fresh) }));
  void client.invalidateQueries({ queryKey: [...chatKey(account), "updates", peer] });
}
