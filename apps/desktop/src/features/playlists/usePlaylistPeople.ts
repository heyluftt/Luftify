import { useEffect, useMemo, useState } from "react";
import type { PlaylistContributor, PlaylistDetails } from "@luft/protocol-types";
import { useFriends } from "../friends/useFriends";
import { playlistAccountKey, resolvePlaylistProfile } from "./playlistIdentity";

export function usePlaylistPeople(details: PlaylistDetails | undefined) {
  const snapshot = useFriends().data?.snapshot ?? undefined;
  const people = useMemo(() => {
    const entries = new Map<string, { person: PlaylistContributor; count: number; owner: boolean }>();
    if (details?.owner) entries.set(details.owner.username, { person: details.owner, count: 0, owner: true });
    for (const track of details?.tracks ?? []) {
      if (!track.addedBy) continue;
      const found = entries.get(track.addedBy.username);
      if (found) found.count++;
      else entries.set(track.addedBy.username, { person: track.addedBy, count: 1, owner: false });
    }
    return [...entries.values()];
  }, [details?.owner, details?.tracks]);
  const identities = people.map(entry => entry.person.username).sort().join("\n");
  const [keys, setKeys] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let active = true;
    const names = identities ? identities.split("\n") : [];
    void Promise.all(names.map(async username => [username, await playlistAccountKey(username)] as const)).then(entries => {
      if (active) setKeys(new Map(entries));
    }).catch(() => { if (active) setKeys(new Map()); });
    return () => { active = false; };
  }, [identities]);
  const profileFor = (person: PlaylistContributor) => resolvePlaylistProfile(person, keys.get(person.username), snapshot);
  return { people, profileFor };
}
