import { EyeOff } from "lucide-react";
import { useState } from "react";
import { t } from "../../../i18n";
import { usePlayerStore } from "../../../stores/playerStore";
import { sharedTrack } from "../../listen-together/roomQueueBatch";
import type { Activity, FriendEntry, FriendsControls, SocialOptions, SocialSnapshot } from "../friendsTypes";
import { ActivityLine } from "../ActivityLine";
import { FriendListening } from "./FriendListening";
import { OwnProfileEditor } from "./OwnProfileEditor";
import { ProfileSheet } from "./ProfileSheet";

const ACTIVITY_TEXT = { online: "friends.online", away: "activity.away", busy: "activity.busy", offline: "activity.mode.invisible" } as const;

/** Your own dot as friends see it; automatic idleness is only known to the server. */
function ownActivity(options: SocialOptions, offline: boolean): Activity {
  if (offline || !options.shareOnline || options.presenceMode === "invisible") return "offline";
  return options.presenceMode === "busy" ? "busy" : options.presenceMode === "away" ? "away" : "online";
}

/**
 * Your own profile the way friends see it, with what you are playing and
 * recently played. Editing opens from the friends page ("Edit").
 */
export function OwnProfileDialog({ snapshot, controls, offline, error, startEditing, onClose }: {
  snapshot: SocialSnapshot;
  controls: FriendsControls;
  offline: boolean;
  error: string | undefined;
  startEditing: boolean;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const playback = usePlayerStore((state) => state.playback);
  const { me, options } = snapshot;
  const track = options.shareListening && playback?.currentItem ? sharedTrack(playback.currentItem) : null;
  // The same entry a friend receives: only what you share.
  const self: FriendEntry = {
    profile: me,
    presence: { online: options.shareOnline, isPlaying: Boolean(track && playback?.isPlaying), track: playback?.isPlaying ? track : null },
    recent: snapshot.recent ?? [],
  };
  const glow = (self.presence.track ?? self.recent?.[0]?.track)?.coverUri;
  const activity = ownActivity(options, offline);

  return <ProfileSheet profile={me} activity={activity} status={<ActivityLine activity={activity} text={t(ACTIVITY_TEXT[activity])} />} glow={glow} wide={editing} onClose={onClose}
    hero={editing ? <OwnProfileEditor me={me} controls={controls} offline={offline} onDone={() => setEditing(false)} /> : undefined}>
    {error && <p className="friends-inline-error friend-profile-error" role="alert">{error}</p>}
    {!editing && !options.shareListening && <p className="own-profile-note"><EyeOff size={15} aria-hidden="true" />{t("ownProfile.notSharing")}</p>}
    {!editing && <FriendListening friend={self} offline={offline} own />}
  </ProfileSheet>;
}
