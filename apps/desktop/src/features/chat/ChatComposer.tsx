import { Music2, Send } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { t } from "../../i18n";
import { usePlayerStore } from "../../stores/playerStore";
import { spotifyOpenUrl } from "../entities/spotifyLinks";
import { conversationKey, type ChatAccount } from "./chatApi";
import { useChatDrafts } from "./chatDrafts";
import { queueChatMessage } from "./sendChatMessage";
import { useLayoutEffect, useRef } from "react";

export function ChatComposer({ account, peer, disabled }: { account: ChatAccount; peer: string; disabled: boolean }) {
  const client = useQueryClient();
  const key = conversationKey(account, peer);
  const body = useChatDrafts((state) => state.drafts[key] ?? "");
  const sending = useChatDrafts((state) => state.outgoing[key]?.some((message) => message.state === "sending") ?? false);
  const count = Array.from(body).length;
  const playing = usePlayerStore((state) => spotifyOpenUrl(state.playback?.currentItem?.uri));
  /** The song playing now goes into the message as a link; the friend sees it as a card. */
  const shareSong = () => {
    if (!playing) return;
    const text = body.trim();
    useChatDrafts.getState().draft(key, text ? `${text} ${playing}` : playing);
  };
  const submit = () => {
    const text = body.trim();
    if (!text || count > 2000 || disabled || sending) return;
    useChatDrafts.getState().draft(key, "");
    queueChatMessage(client, account, peer, text);
  };
  // The field grows with the text, up to a few lines.
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [body]);
  return <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <textarea ref={field} value={body} rows={1} maxLength={4000} aria-label={t("chat.placeholder")} placeholder={t("chat.placeholder")}
      onChange={(event) => useChatDrafts.getState().draft(key, event.currentTarget.value)}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
    <button type="button" className="friends-icon-button chat-share-song" disabled={disabled || !playing}
      title={t("chat.shareSong")} aria-label={t("chat.shareSong")} onClick={shareSong}><Music2 size={18} aria-hidden="true" /></button>
    <div><small data-over={count > 2000 || undefined}>{count > 1800 ? `${count}/2000` : ""}</small>
      <button type="submit" className="primary-button" disabled={disabled || sending || !body.trim() || count > 2000} aria-label={t("chat.send")} title={t("chat.send")}>
        <Send size={18} aria-hidden="true" />
      </button>
    </div>
  </form>;
}
