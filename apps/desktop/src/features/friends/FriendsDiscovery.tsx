import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Search, UserRoundPlus } from "lucide-react";
import { t } from "../../i18n";
import { ProfileAvatar } from "../listen-together/ProfileAvatar";
import { friendsApi } from "./friendsApi";
import { friendsErrorText } from "./useFriends";
import type { FriendsControls, SocialSnapshot } from "./friendsTypes";
import { normalizeFriendCode } from "./friendCode";

export function FriendsDiscovery({ snapshot, controls, disabled }: { snapshot: SocialSnapshot; controls: FriendsControls; disabled: boolean }) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [input]);
  const query = useQuery({
    queryKey: ["friends-search", snapshot.me.id, search],
    queryFn: () => friendsApi.search(search),
    enabled: !disabled && search.length >= 2,
    staleTime: 10_000,
    retry: false,
  });
  return <section className="friends-panel friends-discovery" aria-labelledby="friends-discover-title">
    <div className="friends-section-heading"><div><h2 id="friends-discover-title">{t("friends.findTitle")}</h2><p>{t("friends.findHint")}</p></div><Search size={22} aria-hidden="true" /></div>
    <label className="friends-search-field"><Search size={17} aria-hidden="true" />
      <input type="search" value={input} maxLength={32} placeholder={t("friends.searchPlaceholder")} aria-label={t("friends.searchLabel")}
        autoComplete="off" disabled={disabled} onChange={event => setInput(event.currentTarget.value)} />
    </label>
    {search.length >= 2 && !disabled && <div className="friends-search-results" aria-live="polite" aria-busy={query.isFetching}>
      {query.isFetching && <p className="friends-muted">{t("friends.searching")}</p>}
      {query.isError && <p className="friends-inline-error" role="alert">{friendsErrorText(query.error)}</p>}
      {!query.isFetching && query.isSuccess && !query.data.length && <p className="friends-muted">{t("friends.noResults")}</p>}
      {query.data?.map(profile => {
        const self = profile.id === snapshot.me.id;
        const friend = snapshot.friends.some(entry => entry.profile.id === profile.id);
        const outgoing = snapshot.outgoingRequests.some(entry => entry.profile.id === profile.id);
        const incoming = snapshot.incomingRequests.find(entry => entry.profile.id === profile.id);
        return <div className="friends-person" key={profile.id}>
          <ProfileAvatar name={profile.displayName} uri={profile.avatarUri} />
          <div className="friends-person-copy"><strong>{profile.displayName}</strong><small className="friends-mono">{profile.friendCode}</small></div>
          {self || friend || outgoing ? <span className="friends-small-label">{t(self ? "friends.you" : friend ? "friends.alreadyFriend" : "friends.requestSent")}</span>
            : <button type="button" className="secondary-button" disabled={controls.pending}
              onClick={() => controls.send({ type: "action", action: incoming ? { type: "respondRequest", requestId: incoming.id, accept: true } : { type: "request", friendCode: profile.friendCode } })}>
              <UserRoundPlus size={15} aria-hidden="true" />{t(incoming ? "friends.accept" : "friends.add")}
            </button>}
        </div>;
      })}
    </div>}
    <details className="friends-direct-code"><summary>{t("friends.haveCode")}</summary>
      <form onSubmit={event => {
        event.preventDefault();
        if (!disabled && !controls.pending && code.trim()) controls.send({ type: "action", action: { type: "request", friendCode: normalizeFriendCode(code) } }, () => setCode(""));
      }}>
        <label htmlFor="friends-direct-code">{t("friends.directCodeHint")}</label>
        <div className="friends-inline-controls"><input id="friends-direct-code" className="friends-mono" value={code} maxLength={24} autoComplete="off" spellCheck={false}
          disabled={disabled || controls.pending} onChange={event => setCode(event.currentTarget.value.toUpperCase())} />
          <button type="submit" className="secondary-button" disabled={disabled || controls.pending || !code.trim()}>{t("friends.add")}</button></div>
      </form>
    </details>
  </section>;
}
