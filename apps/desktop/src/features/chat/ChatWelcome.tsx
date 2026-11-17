import { useQueryClient } from "@tanstack/react-query";
import { t } from "../../i18n";
import { usePlayerStore } from "../../stores/playerStore";
import { profileLook } from "../friends/appearance";
import type { SocialProfile } from "../friends/friendsTypes";
import { RoleAvatar } from "../friends/RoleBadge";
import { spotifyOpenUrl } from "../entities/spotifyLinks";
import type { ChatAccount } from "./chatApi";
import { queueChatMessage } from "./sendChatMessage";

/** A chat without messages: the friend, and a few ways to start. */
export function ChatWelcome({ account, profile, online }: { account: ChatAccount; profile: SocialProfile; online: boolean }) {
  const client = useQueryClient();
  const look = profileLook(profile);
  const song = usePlayerStore((state) => spotifyOpenUrl(state.playback?.currentItem?.uri));
  const starts = [t("chat.startHello"), t("chat.startListening"), ...(song ? [song] : [])];
  return <div className="chat-welcome">
    <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="lg" frame={look.frame} accent={look.accent} color={look.color} />
    <strong>{t("chat.welcome", { name: profile.displayName })}</strong>
    <div className="chat-starts">
      {starts.map((text) => <button key={text} type="button" className="chat-start" disabled={!online}
        onClick={() => queueChatMessage(client, account, profile.id, text)}>
        {text === song ? t("chat.startSong") : text}
      </button>)}
    </div>
  </div>;
}
