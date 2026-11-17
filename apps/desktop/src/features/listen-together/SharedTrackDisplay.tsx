import { UserRound } from "lucide-react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { ProfileAvatar } from "./ProfileAvatar";
import type { ListenTogetherParticipant, SharedQueueEntry, SharedTrack } from "./listenTogetherTypes";

export function SharedTrackCover({ track, featured = false }: { track: SharedTrack; featured?: boolean }) {
  return <span className="shared-track-cover" data-featured={featured} aria-hidden="true">
    <AlbumArt title={track.title || t("listen.untitledTrack")} image={track.coverUri} priority={featured} />
  </span>;
}

export function SharedTrackDetails({ track }: { track: SharedTrack }) {
  return <div className="shared-queue-track">
    <strong title={track.title}>{track.title || t("listen.untitledTrack")}</strong>
    <span className="shared-track-artists">{track.artists?.length ? track.artists.join(", ") : t("listen.unknownArtist")}</span>
  </div>;
}

export function SharedTrackAttribution({ entry, participants }: { entry: SharedQueueEntry; participants: ListenTogetherParticipant[] }) {
  const person = participants.find(person => person.id === entry.addedById);
  const name = participants.find(person => person.id === entry.addedById)?.displayName || entry.addedByName;
  return <span className="shared-track-attribution">
    {person?.avatarUri ? <ProfileAvatar name={person.displayName} uri={person.avatarUri} /> : <UserRound size={13} aria-hidden="true" />}
    {name ? t("listen.addedBy", { name }) : t("listen.addedByUnknown")}
  </span>;
}

export function trackDuration(duration?: number): string | undefined {
  if (!duration || duration < 0 || !Number.isFinite(duration)) return undefined;
  const seconds = Math.floor(duration / 1000);
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
