import { Headphones, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { t } from "../i18n";
import { AchievementsPanel } from "../features/friends/achievements/AchievementsPanel";
import { ACHIEVEMENTS } from "../features/friends/achievements/achievements";
import { FriendsActivation } from "../features/friends/FriendsActivation";
import { FriendsDiscovery } from "../features/friends/FriendsDiscovery";
import { FriendsHero } from "../features/friends/FriendsHero";
import { FriendsList } from "../features/friends/FriendsList";
import { FriendsNowListening } from "../features/friends/FriendsNowListening";
import { FriendsOwnerPanel } from "../features/friends/FriendsOwnerPanel";
import { FriendsInvitations, FriendsRequests } from "../features/friends/FriendsRequests";
import { FriendsPlaylistShares } from "../features/friends/FriendsPlaylistShares";
import { FriendsOptions } from "../features/friends/FriendsOptions";
import { FriendProfileDialog } from "../features/friends/profile/FriendProfileDialog";
import { OwnProfileDialog } from "../features/friends/profile/OwnProfileDialog";
import { managesRoles } from "../features/friends/roles";
import { friendsErrorText, useFriends, useFriendsControls } from "../features/friends/useFriends";
import { SERVER_AVAILABLE, ServerNotice } from "../features/server/ServerNotice";

type Tab = "friends" | "achievements" | "visibility" | "luft";
type OpenProfile = { kind: "friend"; id: string } | { kind: "own"; edit: boolean } | null;

export function FriendsPage() {
  const query = useFriends();
  const { controls, mutation } = useFriendsControls();
  const [open, setOpen] = useState<OpenProfile>(null);
  const location = useLocation();
  const fromHash = (): Tab | null => location.hash === "#luft" ? "luft" : location.hash === "#achievements" ? "achievements" : null;
  const [tab, setTab] = useState<Tab>(fromHash() ?? "friends");
  // A notice can lead straight to the Luft corner or the achievements.
  useEffect(() => { const target = fromHash(); if (target) setTab(target); }, [location.hash, location.key]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const status = query.data;
  const snapshot = status?.snapshot;
  const disabled = status?.connection !== "online";
  const error = mutation.isError ? friendsErrorText(mutation.error) : friendsErrorText(status?.error) ?? (query.isError ? t("friends.error.unavailable") : undefined);
  // Looked up on every render, so an open profile follows live presence.
  const friend = open?.kind === "friend" ? snapshot?.friends.find((entry) => entry.profile.id === open.id) : undefined;
  const openProfile = (id: string) => { mutation.reset(); setOpen({ kind: "friend", id }); };
  const openOwn = (edit: boolean) => { mutation.reset(); setOpen({ kind: "own", edit }); };
  const luft = managesRoles(snapshot?.me);
  const tabs: { key: Tab; label: string; count?: string | undefined }[] = [
    { key: "friends", label: t("friends.listTitle"), count: snapshot ? String(snapshot.friends.length) : undefined },
    { key: "achievements", label: t("achievements.tab"), count: snapshot ? `${snapshot.me.achievements?.length ?? 0}/${ACHIEVEMENTS.length}` : undefined },
    { key: "visibility", label: t("friends.optionsTitle") },
    ...(luft || snapshot?.server ? [{ key: "luft" as const, label: t(luft ? "roles.ownerTitle" : "roles.devTitle") }] : []),
  ];
  const shown = tabs.some((entry) => entry.key === tab) ? tab : "friends";

  return <div className="page friends-page">
    <header className="page-heading split"><div><span className="eyebrow"><Users size={14} aria-hidden="true" />{t("friends.eyebrow")}</span><h1>{t("friends.title")}</h1><p>{t("friends.subtitle")}</p></div>
      <Link className="secondary-button" to="/listen"><Headphones size={17} aria-hidden="true" />{t("nav.listenTogether")}</Link>
    </header>
    <ServerNotice />
    {error && !open && SERVER_AVAILABLE && <p className="friends-feedback" role="alert">{error}</p>}
    {mutation.isSuccess && mutation.variables?.type === "invite" && !open && <p className="friends-feedback" data-success="true" role="status">{t("friends.inviteSent")}</p>}
    {query.isPending && <p className="friends-muted" role="status">{t("friends.loading")}</p>}
    {status && !snapshot && <FriendsActivation status={status} controls={controls} />}
    {status && snapshot && <>
      <FriendsHero status={status} snapshot={snapshot} controls={controls} refreshing={query.isFetching}
        onView={() => openOwn(false)} onEdit={() => openOwn(true)}
        onRefresh={() => { if (query.isError) void query.refetch(); else controls.send({ type: "refresh" }); }} />
      <div className="friends-tabs" role="tablist" aria-label={t("friends.title")}>
        {tabs.map((entry) => <button key={entry.key} type="button" role="tab" aria-selected={shown === entry.key}
          data-special={entry.key === "luft" || undefined} data-role={entry.key === "luft" ? "luft" : undefined} onClick={() => setTab(entry.key)}>
          {entry.label}{entry.count && <small>{entry.count}</small>}
        </button>)}
      </div>
      {shown === "friends" && <div className="friends-columns">
        <div className="friends-main">
          <FriendsNowListening friends={snapshot.friends} controls={controls} disabled={disabled} onOpen={openProfile} />
          <FriendsList friends={snapshot.friends} controls={controls} disabled={disabled} onOpen={openProfile} />
        </div>
        {/* Invitations and requests first: they wait for an answer. */}
        <aside className="friends-side">
          <FriendsInvitations snapshot={snapshot} controls={controls} disabled={disabled} />
          <FriendsPlaylistShares snapshot={snapshot} controls={controls} disabled={disabled} />
          <FriendsRequests snapshot={snapshot} controls={controls} disabled={disabled} />
          <FriendsDiscovery snapshot={snapshot} controls={controls} disabled={disabled} />
        </aside>
      </div>}
      {shown === "achievements" && <div className="friends-tab-body"><AchievementsPanel snapshot={snapshot} /></div>}
      {shown === "visibility" && <div className="friends-tab-body"><FriendsOptions snapshot={snapshot} controls={controls} disabled={disabled} /></div>}
      {shown === "luft" && <div className="friends-tab-body"><FriendsOwnerPanel snapshot={snapshot} controls={controls} disabled={disabled} focusId={focusId} onOpen={openProfile} /></div>}
    </>}
    {snapshot && friend && <FriendProfileDialog friend={friend} me={snapshot.me} controls={controls} offline={disabled}
      error={mutation.isError ? friendsErrorText(mutation.error) : undefined}
      onManage={() => { setOpen(null); setTab("luft"); setFocusId(friend.profile.id); }} onClose={() => setOpen(null)} />}
    {snapshot && open?.kind === "own" && <OwnProfileDialog snapshot={snapshot} controls={controls} offline={disabled} startEditing={open.edit}
      error={mutation.isError ? friendsErrorText(mutation.error) : undefined} onClose={() => setOpen(null)} />}
  </div>;
}
