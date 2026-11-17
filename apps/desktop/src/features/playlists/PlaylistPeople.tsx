import { UserRound } from "lucide-react";
import type { PlaylistContributor } from "@luft/protocol-types";
import type { SocialProfile } from "../friends/friendsTypes";
import { RoleAvatar } from "../friends/RoleBadge";
import { profileLook } from "../friends/appearance";
import { t } from "../../i18n";
import { PlaylistPeopleOverflow } from "./PlaylistPeopleOverflow";

export interface PlaylistPersonEntry { person: PlaylistContributor; count: number; owner: boolean }

export function PlaylistPerson({ profile }: { profile: SocialProfile | undefined }) {
  const look = profile && profileLook(profile);
  return <span className="playlist-person" title={profile?.displayName ?? t("playlists.unassigned")}>
    {profile ? <RoleAvatar name={profile.displayName} uri={profile.avatarUri} roles={profile.roles} size="sm" frame={look?.frame} accent={look?.accent} color={look?.color} /> : <UserRound size={16} aria-hidden="true" />}
    <span>{profile?.displayName ?? t("playlists.unassigned")}</span>
  </span>;
}

export function PlaylistPeople({ people, profileFor, complete }: {
  people: PlaylistPersonEntry[];
  profileFor: (person: PlaylistContributor) => SocialProfile | undefined;
  complete: boolean;
}) {
  if (!people.length) return null;
  return <div className="playlist-people" role="group" aria-label={t("playlists.people")}>
    {people.slice(0, 3).map(({ person, count, owner }) => <span className="playlist-person-chip" key={person.username}
      title={[owner ? t("playlists.owner") : "", t(count === 1 ? "playlists.contributionOne" : "playlists.contributionMany", { n: count }), complete ? "" : t("playlists.peoplePartial")].filter(Boolean).join(" · ")}>
      <PlaylistPerson profile={profileFor(person)} />
    </span>)}
    {people.length > 3 && <PlaylistPeopleOverflow people={people.slice(3)} profileFor={profileFor} complete={complete} />}
  </div>;
}
