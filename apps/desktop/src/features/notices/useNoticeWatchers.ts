import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { SocialSnapshot } from "../friends/friendsTypes";
import { managesRoles } from "../friends/roles";
import { endedText, listenAlongState } from "../friends/listen-along/listenAlong";
import { useFriends, useFriendsControls } from "../friends/useFriends";
import { useListenTogether } from "../listen-together/useListenTogether";
import type { ListenTogetherStatus } from "../listen-together/listenTogetherTypes";
import { REPORTS_QUERY_KEY, problemReportApi, type ProblemReportSummary } from "../problem-report/problemReportApi";
import { achievementChanges, friendChanges, reportChanges, roomChanges, type NoticeChanges } from "./noticeDiff";
import { desktopApi } from "../../services/desktopApi";
import { allowsNotice } from "./noticePrefs";
import { pushNotice, retireNotice } from "./noticeStore";

const REPORTS_EVERY_MS = 5 * 60_000;

/**
 * Turns changes in friends, the room and Luft's reports into notices. The
 * first state after start is the baseline, so nothing old pops up. The page
 * that already shows it keeps one away; "Do not disturb" only lists it under
 * the bell; switched off in the settings, it does not come at all.
 */
export function useNoticeWatchers() {
  const friends = useFriends().data;
  const room = useListenTogether().query.data;
  const path = useLocation().pathname;
  const prefs = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings }).data?.notifications;
  const snapshot = friends?.connection === "online" ? friends.snapshot : null;
  const quiet = snapshot?.options.presenceMode === "busy";
  const luft = managesRoles(snapshot?.me);
  const reports = useQuery({
    queryKey: REPORTS_QUERY_KEY, queryFn: problemReportApi.list,
    enabled: luft, refetchInterval: REPORTS_EVERY_MS, staleTime: 60_000, retry: false,
  }).data;

  const apply = (changes: NoticeChanges, show: boolean) => {
    changes.dismiss.forEach(retireNotice);
    if (!show) return;
    for (const notice of changes.push) if (allowsNotice(prefs, notice.kind)) pushNotice(notice, { quiet });
  };

  const lastFriends = useRef<SocialSnapshot | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    // Invitations expire within minutes, so one already waiting at start still shows.
    const before = lastFriends.current ?? { ...snapshot, invitations: [] };
    apply(friendChanges(before, snapshot), path !== "/friends");
    // The first snapshot after start is the baseline: nothing old pops up.
    if (lastFriends.current) apply(achievementChanges(lastFriends.current, snapshot), true);
    lastFriends.current = snapshot;
  }, [snapshot]);

  const along = listenAlongState(friends);
  const { controls } = useFriendsControls();
  useEffect(() => {
    if (along?.phase !== "ended") return;
    if (allowsNotice(prefs, "along")) pushNotice({ id: `along-ended-${along.profileId}`, kind: "along", title: endedText(along.reason, along.name) }, { quiet });
    controls.send({ type: "stopListenAlong" });
  }, [along?.phase, along?.profileId]);

  const lastRoom = useRef<ListenTogetherStatus | null>(null);
  useEffect(() => {
    if (!room) return;
    if (lastRoom.current) {
      const changes = roomChanges(lastRoom.current, room);
      // On the room page the people list already shows who came and went.
      if (path === "/listen") changes.push = changes.push.filter((notice) => notice.kind !== "room");
      apply(changes, true);
    }
    lastRoom.current = room;
  }, [room]);

  const lastReports = useRef<ProblemReportSummary[] | null>(null);
  useEffect(() => {
    if (!reports) return;
    if (lastReports.current) apply(reportChanges(lastReports.current, reports), true);
    lastReports.current = reports;
  }, [reports]);
}
