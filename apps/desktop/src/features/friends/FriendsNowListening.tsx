import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { accentColor, profileLook } from "./appearance";
import { ListenAlongButton } from "./listen-along/ListenAlongButton";
import { RoleAvatar } from "./RoleBadge";
import type { FriendEntry, FriendPresence, FriendsControls } from "./friendsTypes";

/** The friends playing something right now: song, who, how far, and listening along. */
export function FriendsNowListening({ friends, controls, disabled, onOpen }: {
  friends: FriendEntry[];
  controls: FriendsControls;
  disabled: boolean;
  onOpen: (profileId: string) => void;
}) {
  const listening = disabled ? [] : friends.filter((friend) => friend.presence.track && friend.presence.isPlaying);
  const now = useSecondTick(listening.length > 0);
  if (!listening.length) return null;
  return <section className="friends-now" aria-labelledby="friends-now-title">
    <h2 id="friends-now-title"><span className="friends-now-playing" aria-hidden="true"><i /><i /><i /></span>{t("friendProfile.nowTitle")}</h2>
    <ul>{listening.map((friend, index) => {
      const { profile, presence } = friend;
      const track = presence.track!;
      const look = profileLook(profile);
      const progress = playedShare(presence, now);
      return <li key={profile.id} className="friends-now-card" data-accent={look.accent}
        style={{ "--i": Math.min(index, 8), ...accentColor(look.color) } as CSSProperties}>
        <span className="friends-now-backdrop" aria-hidden="true"><AlbumArt title="" image={track.coverUri} size="small" /></span>
        <button type="button" className="friends-now-main" onClick={() => onOpen(profile.id)} aria-label={t("friendProfile.open", { name: profile.displayName })}>
          <span className="friends-now-art"><AlbumArt title={track.title || ""} image={track.coverUri} size="small" /></span>
          <span className="friends-now-copy">
            <strong>{track.title || t("listen.untitledTrack")}</strong>
            <small>{track.artists?.join(", ") || t("listen.unknownArtist")}</small>
            <span className="friends-now-who">
              <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="sm" />
              {profile.displayName}
            </span>
          </span>
        </button>
        <ListenAlongButton friend={friend} controls={controls} disabled={disabled} compact />
        {progress !== null && <i className="friends-now-progress" aria-hidden="true"><b style={{ width: `${progress * 100}%` }} /></i>}
      </li>;
    })}</ul>
  </section>;
}

/** How much of the song has played, from the shared position and the server time it was taken. */
function playedShare(presence: FriendPresence, now: number): number | null {
  const duration = presence.track?.durationMs;
  if (!duration || presence.positionMs == null || presence.positionAtMs == null) return null;
  const position = presence.positionMs + Math.max(0, now - presence.positionAtMs);
  return Math.min(1, Math.max(0, position / duration));
}

/** The current time, once a second while something needs it. */
function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
