import { AudioLines, Square } from "lucide-react";
import { t } from "../../../i18n";
import type { FriendEntry, FriendsControls } from "../friendsTypes";
import { useFriends } from "../useFriends";
import { canListenAlong } from "./listenAlong";

/** Start listening along with a friend, or stop it when already doing so. */
export function ListenAlongButton({ friend, controls, disabled, compact = false }: {
  friend: FriendEntry;
  controls: FriendsControls;
  disabled: boolean;
  /** An icon button, as on the friend cards. */
  compact?: boolean;
}) {
  const along = useFriends().data?.listenAlong;
  const active = along?.profileId === friend.profile.id && along.phase !== "ended";
  if (!active && !canListenAlong(friend, disabled)) return null;
  const label = active ? t("listenAlong.stop") : t("listenAlong.startName", { name: friend.profile.displayName });
  const Icon = active ? Square : AudioLines;
  const run = () => controls.send(active ? { type: "stopListenAlong" } : { type: "listenAlong", profileId: friend.profile.id });
  if (compact) {
    return <button type="button" className="friends-icon-button listen-along-button" data-active={active || undefined}
      disabled={disabled || controls.pending} onClick={run} title={label} aria-label={label} aria-pressed={active}>
      <Icon size={17} aria-hidden="true" />
    </button>;
  }
  return <button type="button" className={active ? "secondary-button" : "primary-button"} disabled={disabled || controls.pending} onClick={run} aria-pressed={active}>
    <Icon size={16} aria-hidden="true" />{active ? t("listenAlong.stop") : t("listenAlong.start")}
  </button>;
}
