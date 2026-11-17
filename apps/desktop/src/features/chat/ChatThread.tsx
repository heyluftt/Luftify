import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, LoaderCircle, RotateCcw } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { appLanguage, t } from "../../i18n";
import { accentColor, nameAttrs, profileLook } from "../friends/appearance";
import type { SocialProfile } from "../friends/friendsTypes";
import { chatApi, conversationKey, threadKey, type ChatAccount } from "./chatApi";
import { ChatAvatar } from "./ChatAvatar";
import { ChatComposer } from "./ChatComposer";
import { useChatDrafts } from "./chatDrafts";
import { mergeChatMessages, type ChatThreadData } from "./chatMessages";
import { sendChatMessage } from "./sendChatMessage";
import { useChatInbox, useChatThread } from "./useChat";
import { ChatMessageBody } from "./ChatMessageBody";
import { ChatListening } from "./ChatListening";
import { ChatWelcome } from "./ChatWelcome";
import { useChatRead, useChatVisible } from "./useChatRead";

const NO_OUTGOING: never[] = [];
const time = (at: number) => new Date(at).toLocaleTimeString(appLanguage(), { hour: "2-digit", minute: "2-digit" });
/** Messages from one person within five minutes share one bubble stack and one time. */
const GROUP_MS = 5 * 60_000;
const sameGroup = (a: { senderId: string; createdAtMs: number } | undefined, b: { senderId: string; createdAtMs: number } | undefined) =>
  Boolean(a && b && a.senderId === b.senderId && Math.abs(b.createdAtMs - a.createdAtMs) < GROUP_MS && day(a.createdAtMs) === day(b.createdAtMs));
const day = (at: number) => new Date(at).toLocaleDateString(appLanguage(), { day: "numeric", month: "long", year: "numeric" });

export function ChatThread({ account, profile, online }: { account: ChatAccount; profile: SocialProfile; online: boolean }) {
  const client = useQueryClient();
  const peer = profile.id;
  const { thread, updates } = useChatThread(account, peer, online);
  const list = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const visible = useChatVisible();
  const outgoing = useChatDrafts((state) => state.outgoing[conversationKey(account, peer)] ?? NO_OUTGOING);
  const olderPosition = useRef<{ top: number; height: number } | undefined>(undefined);
  const sentCount = useRef(outgoing.length);
  /** The newest message seen at the bottom; what came after it counts as new while reading older ones. */
  const [seenThrough, setSeenThrough] = useState(0);
  const look = profileLook(profile);
  const older = useMutation({
    mutationFn: () => chatApi.messages(account, peer, { before: thread.data?.messages[0]?.id ?? 0 }),
    onSuccess: (page) => {
      client.setQueryData<ChatThreadData>(threadKey(account, peer), (old) => old && ({ ...old, messages: mergeChatMessages(old.messages, page.messages), hasOlder: page.hasMore }));
    },
  });
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    // Sending something yourself always shows it, also while reading older messages.
    if (outgoing.length > sentCount.current) { nearBottom.current = true; setAtBottom(true); }
    sentCount.current = outgoing.length;
    if (olderPosition.current) {
      element.scrollTop = olderPosition.current.top + element.scrollHeight - olderPosition.current.height;
      olderPosition.current = undefined;
    } else if (nearBottom.current) element.scrollTop = element.scrollHeight;
  }, [thread.data?.messages, outgoing]);
  useChatRead(account, peer, thread.data?.cursor ?? 0, online && visible && atBottom && !thread.isError && !updates.isError);
  const jump = () => { nearBottom.current = true; setAtBottom(true); if (list.current) list.current.scrollTop = list.current.scrollHeight; };
  const messages = thread.data?.messages ?? [];
  const newestId = messages.at(-1)?.id ?? 0;
  useLayoutEffect(() => { if (atBottom) setSeenThrough(newestId); }, [atBottom, newestId]);
  const unseen = atBottom ? 0 : messages.filter((message) => message.id > seenThrough && message.senderId !== account.profileId).length;
  const peerRead = useChatInbox().data?.find((chat) => chat.profile.id === peer)?.peerRead ?? 0;
  const lastOwn = [...messages].reverse().find((message) => message.senderId === account.profileId);
  return <section className="chat-thread" aria-label={profile.displayName} data-accent={look.accent} style={accentColor(look.color)}>
    <header className="chat-thread-heading">
      <Link className="friends-icon-button chat-back" to="/messages" aria-label={t("chat.back")}><ArrowLeft size={18} /></Link>
      <ChatAvatar profile={profile} size="md" />
      <span className="chat-thread-who">
        <strong className="profile-name" {...nameAttrs(look)}>{profile.displayName}</strong>
        {online ? <ChatListening peer={peer} /> : <small>{t("chat.offline")}</small>}
      </span>
    </header>
    <div ref={list} className="chat-message-list" role="log" aria-label={t("chat.history")} aria-live="off"
      onScroll={() => {
        const element = list.current!;
        nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
        setAtBottom(nearBottom.current);
      }}>
      {thread.data?.hasOlder && <button type="button" className="secondary-button chat-load-older" disabled={older.isPending || !online}
        onClick={() => { if (list.current) olderPosition.current = { top: list.current.scrollTop, height: list.current.scrollHeight }; older.mutate(undefined, { onError: () => { olderPosition.current = undefined; } }); }}>
        {older.isPending && <LoaderCircle className="playlist-preparation-spinner" size={14} />}{t("chat.older")}
      </button>}
      {(thread.isError || updates.isError || older.isError) && <div className="chat-error" role="alert">
        <span>{t("chat.loadFailed")}</span><button className="friends-icon-button" type="button" title={t("chat.retry")} aria-label={t("chat.retry")}
          onClick={() => { older.reset(); void (thread.isError ? thread.refetch() : updates.refetch()); }}><RotateCcw size={16} /></button>
      </div>}
      {thread.isLoading && <div className="chat-empty"><LoaderCircle className="playlist-preparation-spinner" size={24} /></div>}
      {!thread.isLoading && !thread.isError && !messages.length && !outgoing.length && <ChatWelcome account={account} profile={profile} online={online} />}
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const date = day(message.createdAtMs);
        const own = message.senderId === account.profileId;
        const joined = sameGroup(previous, message);
        const continues = sameGroup(message, messages[index + 1]);
        return <div className="chat-message-group" key={message.id} data-joined={joined || undefined}>
          {(!previous || date !== day(previous.createdAtMs)) && <div className="chat-day">{date}</div>}
          <article className="chat-message" data-own={own || undefined} data-continues={continues || undefined}>
            <ChatMessageBody body={message.body} />
            {!continues && <time dateTime={new Date(message.createdAtMs).toISOString()}>{time(message.createdAtMs)}</time>}
          </article>
          {own && message === lastOwn && peerRead >= message.id && <small className="chat-seen">{t("chat.seen")}</small>}
        </div>;
      })}
      {outgoing.map((pending) => <article className="chat-message" data-own data-pending key={pending.clientId}>
        <p>{pending.body}</p><footer><time>{time(pending.at)}</time>
          {pending.state === "sending" ? <span><LoaderCircle className="playlist-preparation-spinner" size={12} />{t("chat.sending")}</span>
            : <button type="button" disabled={!online} onClick={() => void sendChatMessage(client, account, peer, pending)}>
              <RotateCcw size={12} aria-hidden="true" />{t("chat.resend")}
            </button>}
        </footer>
      </article>)}
    </div>
    {!atBottom && <button type="button" className="secondary-button chat-jump" data-new={unseen > 0 || undefined} onClick={jump}>
      <ArrowDown size={14} />{unseen === 1 ? t("chat.newOne") : unseen > 1 ? t("chat.newMany", { n: unseen }) : t("chat.latest")}
    </button>}
    <ChatComposer account={account} peer={peer} disabled={!online || !thread.data} />
  </section>;
}
