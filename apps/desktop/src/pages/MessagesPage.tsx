import { MessageCircle, RotateCcw, Search } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { t } from "../i18n";
import { ChatAvatar } from "../features/chat/ChatAvatar";
import { ChatThread } from "../features/chat/ChatThread";
import { useChatAccount, useChatInbox } from "../features/chat/useChat";
import { ServerNotice } from "../features/server/ServerNotice";

export function MessagesPage() {
  const { peer } = useParams();
  const { account, online, friends } = useChatAccount();
  const inbox = useChatInbox();
  const [search, setSearch] = useState("");
  const selected = friends.find((friend) => friend.profile.id === peer)?.profile;
  const chats = inbox.data ?? friends.map(({ profile }) => ({ profile, lastMessage: null, unread: 0 }));
  const visible = chats.filter(({ profile }) => profile.displayName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="page chat-page">
    <header className="chat-page-heading"><MessageCircle size={23} aria-hidden="true" /><h1>{t("chat.title")}</h1></header>
    <ServerNotice />
    {!account ? <div className="chat-empty"><Link className="secondary-button" to="/friends">{t("nav.friends")}</Link></div> :
      <div className="chat-layout" data-selected={Boolean(peer)}>
        <aside className="chat-conversations" aria-label={t("chat.title")}>
          <label className="chat-search"><Search size={16} aria-hidden="true" /><input type="search" value={search} maxLength={64}
            placeholder={t("chat.search")} aria-label={t("chat.search")} onChange={(event) => setSearch(event.currentTarget.value)} /></label>
          {inbox.isError && <div className="chat-error"><span>{t("chat.loadFailed")}</span><button type="button" className="friends-icon-button"
            title={t("chat.retry")} aria-label={t("chat.retry")} onClick={() => void inbox.refetch()}><RotateCcw size={16} /></button></div>}
          <div className="chat-conversation-list">
            {visible.map((chat) => {
              const presence = friends.find((friend) => friend.profile.id === chat.profile.id)?.presence;
              const playing = presence?.isPlaying ? presence.track : null;
              const line = chat.lastMessage
                ? `${chat.lastMessage.senderId === account.profileId ? `${t("chat.you")}: ` : ""}${chat.lastMessage.body}`
                : playing ? `♪ ${[playing.title, playing.artists?.[0]].filter(Boolean).join(" · ")}` : t(presence?.online ? "chat.online" : "chat.away");
              return <NavLink to={`/messages/${chat.profile.id}`} key={chat.profile.id} className={({ isActive }) => `chat-conversation${isActive ? " active" : ""}`}>
              <span className="chat-conversation-avatar" data-online={presence?.online || undefined}><ChatAvatar profile={chat.profile} size="md" /></span>
              <span className="chat-conversation-copy"><strong>{chat.profile.displayName}</strong>
                <small data-playing={!chat.lastMessage && playing ? true : undefined}>{line}</small>
              </span>{chat.unread > 0 && <i aria-label={t("chat.unread", { n: chat.unread })}>{chat.unread > 99 ? "99+" : chat.unread}</i>}
            </NavLink>;
            })}
            {!visible.length && <div className="chat-empty"><span>{t(search ? "chat.noMatch" : "chat.noFriends")}</span>{!search && <Link to="/friends" className="secondary-button">{t("nav.friends")}</Link>}</div>}
          </div>
        </aside>
        {selected ? <ChatThread key={JSON.stringify([account.serverUrl, account.profileId, selected.id])} account={account} profile={selected} online={online} /> :
          <section className="chat-empty chat-unselected"><MessageCircle size={38} aria-hidden="true" /><span>{t(peer ? "chat.unavailable" : "chat.select")}</span>
            {peer && <Link className="secondary-button" to="/messages">{t("chat.back")}</Link>}
          </section>}
      </div>}
  </div>;
}
