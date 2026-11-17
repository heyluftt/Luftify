import {
  ArrowRight,
  BarChart3,
  Clock3,
  Disc3,
  LockKeyhole,
  Music2,
  UsersRound,
} from "lucide-react";

import { AlbumArt } from "../../components/AlbumArt";
import { HomeWeekPulse } from "./HomeWeekPulse";
import { t } from "../../i18n";
import {
  formatCount,
  formatListeningTime,
  joinCreatorNames,
} from "../analytics/analyticsFormatting";
import type {
  AnalyticsTrack,
  ListeningOverview,
} from "../analytics/analyticsTypes";

interface HomeListeningSnapshotProps {
  enabled: boolean;
  error: boolean;
  loading: boolean;
  overview: ListeningOverview | undefined;
  onOpen: () => void;
  onOpenSettings: () => void;
  onPlayTrack?: (track: AnalyticsTrack) => void;
}

export function HomeListeningSnapshot({
  enabled,
  error,
  loading,
  overview,
  onOpen,
  onOpenSettings,
  onPlayTrack,
}: HomeListeningSnapshotProps) {
  return (
    <section className="section-block home-listening-section">
      <div className="section-title">
        <h2>{t("analytics.home.week")}</h2>
        <button type="button" className="text-button" onClick={onOpen}>
          {t("nav.insights")}
          <ArrowRight size={15} />
        </button>
      </div>

      <div className="home-listening-card">
        {loading ? (
          <HomeListeningState
            icon={BarChart3}
            title={t("home.loading")}
            loading
          />
        ) : error ? (
          <HomeListeningState
            icon={BarChart3}
            title={t("analytics.home.unavailable")}
            action={t("settings.analytics.open")}
            onAction={onOpen}
          />
        ) : !enabled ? (
          <HomeListeningState
            icon={LockKeyhole}
            title={t("analytics.disabled")}
            action={t("analytics.home.openSettings")}
            onAction={onOpenSettings}
          />
        ) : !overview || overview.totalListeningMs <= 0 ? (
          <HomeListeningState
            icon={Music2}
            title={t("analytics.home.noData")}
          />
        ) : (
          <HomeListeningContent
            overview={overview}
            {...(onPlayTrack ? { onPlayTrack } : {})}
          />
        )}
      </div>
    </section>
  );
}

function HomeListeningContent({
  overview,
  onPlayTrack,
}: {
  overview: ListeningOverview;
  onPlayTrack?: (track: AnalyticsTrack) => void;
}) {
  const topTrack = overview.topTracks[0]?.track;
  const metrics = [
    {
      icon: Clock3,
      label: t("analytics.listeningTime"),
      value: formatListeningTime(overview.totalListeningMs),
    },
    {
      icon: Disc3,
      label: t("analytics.songs"),
      value: formatCount(overview.uniqueTrackCount),
    },
    {
      icon: UsersRound,
      label: t("analytics.artists"),
      value: formatCount(overview.uniqueArtistCount),
    },
  ];

  return (
    <>
      <div className="home-listening-metrics">
        {metrics.map(({ icon: Icon, label, value }, index) => (
          <div className="home-listening-metric" key={label}>
            <span aria-hidden="true"><Icon /></span>
            <small>{label}</small>
            <strong>{value}</strong>
            {index === 0 && <HomeWeekPulse days={overview.dailyActivity} />}
          </div>
        ))}
      </div>

      {topTrack && onPlayTrack ? (
        <button
          type="button"
          className="home-listening-highlight is-playable"
          onClick={() => onPlayTrack(topTrack)}
        >
          <AlbumArt
            title={topTrack.title}
            image={topTrack.coverUri}
          />
          <span>
            <small>{t("analytics.home.playTop")}</small>
            <strong title={topTrack.title}>{topTrack.title}</strong>
            <em title={joinCreatorNames(topTrack.creators)}>
              {joinCreatorNames(topTrack.creators)}
            </em>
          </span>
        </button>
      ) : (
        <div className="home-listening-highlight">
          {topTrack ? (
            <>
              <AlbumArt
                title={topTrack.title}
                image={topTrack.coverUri}
              />
              <span>
                <small>{t("analytics.topTrack")}</small>
                <strong title={topTrack.title}>{topTrack.title}</strong>
                <em title={joinCreatorNames(topTrack.creators)}>
                  {joinCreatorNames(topTrack.creators)}
                </em>
              </span>
            </>
          ) : (
            <>
              <span className="home-listening-highlight-icon" aria-hidden="true">
                <BarChart3 />
              </span>
              <span>
                <small>{t("analytics.home.thisWeek")}</small>
                <strong>{t("analytics.home.countedPlays", { n: formatCount(overview.qualifiedPlayCount) })}</strong>
                <em>{t("analytics.home.localNote")}</em>
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}

function HomeListeningState({
  icon: Icon,
  title,
  description,
  action,
  onAction,
  loading = false,
}: {
  icon: typeof BarChart3;
  title: string;
  description?: string;
  action?: string;
  onAction?: () => void;
  loading?: boolean;
}) {
  return (
    <div className={`home-listening-state${loading ? " is-loading" : ""}`}>
      <span aria-hidden="true"><Icon /></span>
      <div>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      {action && onAction && (
        <button type="button" className="text-button" onClick={onAction}>
          {action}
          <ArrowRight size={15} />
        </button>
      )}
    </div>
  );
}
