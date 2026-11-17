import type { MediaItem } from "@luft/protocol-types";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { TrackActionsMenu } from "../../components/track-actions/TrackActionsMenu";
import { findFocusTrackIndex } from "../../components/trackFocus";
import { usePlayerStore } from "../../stores/playerStore";
import { playbackCommands } from "../playback/playbackCommands";
import { desktopApi } from "../../services/desktopApi";
import { appLanguage, t } from "../../i18n";
import { useRecentlyPlayed } from "./useRecentlyPlayed";
import { recentDayLabel, recentTrackDays, type RecentDayLabel } from "./recentTracks";
import { RecentTrackRow } from "./RecentTrackRow";
import "../../styles/pages/recent.css";

interface OpenActions {
  item: MediaItem;
  position: { x: number; y: number };
}

export function RecentContent({ onNavigate }: { onNavigate: () => void }) {
  const query = useRecentlyPlayed();
  const settings = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings });
  const current = usePlayerStore((state) => state.playback?.currentItem);
  const playing = usePlayerStore((state) => state.playback?.isPlaying === true);
  const [actions, setActions] = useState<OpenActions>();
  const days = useMemo(() => recentTrackDays(query.data ?? []), [query.data]);
  const tracks = useMemo(() => days.flatMap((day) => day.entries.map((entry) => entry.item)), [days]);
  const active = current ? tracks[findFocusTrackIndex(tracks, current.uri, current)]?.uri : undefined;
  const formats = useMemo(() => {
    const language = appLanguage();
    return {
      time: new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }),
      weekday: new Intl.DateTimeFormat(language, { weekday: "long" }),
      date: new Intl.DateTimeFormat(language, { day: "numeric", month: "long" }),
      dateWithYear: new Intl.DateTimeFormat(language, { dateStyle: "long" }),
    };
  }, []);
  const dayTitle = (label: RecentDayLabel) => {
    if (label.kind === "today") return t("recent.today");
    if (label.kind === "yesterday") return t("recent.yesterday");
    if (label.kind === "weekday") return formats.weekday.format(label.date);
    return label.date.getFullYear() === new Date().getFullYear()
      ? formats.date.format(label.date)
      : formats.dateWithYear.format(label.date);
  };

  return (
    <div className="recent-content">
      {settings.data?.listeningAnalyticsEnabled === false && (
        <p className="recent-notice">{t("recent.disabled")} <Link onClick={onNavigate} to="/settings?focus=privacy">{t("nav.settings")}</Link></p>
      )}
      {query.isPending && <p role="status">{t("recent.loading")}</p>}
      {query.isError && <div className="recent-notice" role="alert">
        <p>{t("recent.error")}</p>
        <button className="secondary-button" type="button" disabled={query.isFetching}
          onClick={() => void query.refetch()}>{t("settings.retry")}</button>
      </div>}
      {query.isSuccess && !tracks.length && <p className="recent-notice">{t("recent.empty")}</p>}
      {days.map((day) => (
        <section key={day.key} className="recent-day" aria-labelledby={`recent-${day.key}`}>
          <h3 id={`recent-${day.key}`}>{dayTitle(recentDayLabel(day.date))}</h3>
          {day.entries.map((entry) => (
            <RecentTrackRow
              key={entry.item.uri}
              entry={entry}
              time={formats.time.format(entry.playedAt)}
              current={entry.item.uri === active}
              playing={playing}
              onPlay={() => playbackCommands.playUri(entry.item.uri, tracks)}
              onOpenActions={(item, position) => setActions({ item, position })}
            />
          ))}
        </section>
      ))}
      {actions && (
        <TrackActionsMenu
          key={`${actions.item.uri}:${actions.position.x}:${actions.position.y}`}
          track={actions.item}
          position={actions.position}
          initialView="actions"
          canQueue
          saved={false}
          onSavedChange={undefined}
          onClose={() => setActions(undefined)}
        />
      )}
    </div>
  );
}
