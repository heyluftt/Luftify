import { t } from "../../i18n";
import { ListenAlongButton } from "../friends/listen-along/ListenAlongButton";
import { useFriends, useFriendsControls } from "../friends/useFriends";

/** In the chat heading: what the friend plays right now, with listening along one click away. */
export function ChatListening({ peer }: { peer: string }) {
  const friend = useFriends().data?.snapshot?.friends.find((entry) => entry.profile.id === peer);
  const { controls } = useFriendsControls();
  const track = friend?.presence.isPlaying ? friend.presence.track : null;
  if (!friend) return null;
  if (!track) return <small className="chat-status">{t(friend.presence.online ? "chat.online" : "chat.away")}</small>;
  const title = [track.title, track.artists?.[0]].filter(Boolean).join(" · ");
  return <span className="chat-listening">
    <span className="friends-now-playing" aria-hidden="true"><i /><i /><i /></span>
    <small>{t("chat.listening", { title })}</small>
    <ListenAlongButton friend={friend} controls={controls} disabled={false} compact />
  </span>;
}
