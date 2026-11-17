import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnalyticsRangePicker } from "../features/analytics/AnalyticsRangePicker";
import {
  AnalyticsDisabledState,
  AnalyticsEmptyState,
  AnalyticsErrorState,
  AnalyticsLoadingState,
} from "../features/analytics/AnalyticsStates";
import { playAnalyticsTrack } from "../features/analytics/analyticsPlayback";
import { DEFAULT_ANALYTICS_RANGE } from "../features/analytics/analyticsRanges";
import type { AnalyticsRangeKey } from "../features/analytics/analyticsTypes";
import { InsightsHabits } from "../features/analytics/insights/InsightsHabits";
import { InsightsOverview } from "../features/analytics/insights/InsightsOverview";
import { InsightsRankings } from "../features/analytics/insights/InsightsRankings";
import { InsightsRhythm } from "../features/analytics/insights/InsightsRhythm";
import { InsightsSpotlights } from "../features/analytics/insights/InsightsSpotlights";
import { rangeDates } from "../features/analytics/insights/rangeDates";
import { useAnalyticsArtistDisplays } from "../features/analytics/useAnalyticsArtistDisplays";
import { useListeningOverview, usePreviousOverview } from "../features/analytics/useListeningOverview";
import { useTopPlaylistDetails } from "../features/analytics/useTopPlaylistDetails";
import { usePlaybackActions } from "../features/playback/usePlayback";
import { t } from "../i18n";
import { desktopApi } from "../services/desktopApi";

/**
 * "Höranalyse": the range as one big number with its course and change, the
 * number ones, the top ten, when the music plays and how you listen.
 */
export function InsightsPage() {
  const navigate = useNavigate();
  const { playContext, playUri } = usePlaybackActions();
  const [rangeKey, setRangeKey] = useState<AnalyticsRangeKey>(DEFAULT_ANALYTICS_RANGE);
  const settings = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings });
  const analyticsEnabled = settings.data?.listeningAnalyticsEnabled ?? true;
  const { query } = useListeningOverview(rangeKey, analyticsEnabled);
  const previous = usePreviousOverview(rangeKey, analyticsEnabled && Boolean(query.data));
  const overview = query.data;
  const artistDisplays = useAnalyticsArtistDisplays((overview?.topArtists ?? []).slice(0, 10), analyticsEnabled && Boolean(overview));
  const playlistDetails = useTopPlaylistDetails(overview, analyticsEnabled && Boolean(overview));
  const empty = Boolean(overview) && overview!.totalListeningMs <= 0 && overview!.topTracks.length === 0;
  const playTrack = (track: Parameters<typeof playAnalyticsTrack>[0]) => playAnalyticsTrack(track, { playContext, playUri });

  return (
    <div className="page insights-page">
      <header className="page-heading split insights-heading">
        <div>
          <h1>{t("nav.insights")}</h1>
          {overview && <p>{rangeDates(rangeKey, overview)}</p>}
        </div>
        <AnalyticsRangePicker value={rangeKey} onChange={setRangeKey} />
      </header>

      {!analyticsEnabled ? <AnalyticsDisabledState />
        : query.isLoading ? <AnalyticsLoadingState />
        : query.isError ? <AnalyticsErrorState retry={() => void query.refetch()} />
        : empty || !overview ? <AnalyticsEmptyState />
        : (
          <div className="insights-content" key={rangeKey}>
            <InsightsOverview overview={overview} previous={previous.data ?? undefined} rangeKey={rangeKey} />
            <InsightsSpotlights
              overview={overview}
              artistDisplays={artistDisplays}
              onPlayTrack={playTrack}
              onOpenArtist={(uri) => navigate(`/artist/${encodeURIComponent(uri)}`)}
            />
            <InsightsRankings
              overview={overview}
              artistDisplays={artistDisplays}
              playlistDetails={playlistDetails}
              onPlayTrack={playTrack}
              onOpenArtist={(uri) => navigate(`/artist/${encodeURIComponent(uri)}`)}
              onOpenPlaylist={(uri) => navigate(`/playlist/${encodeURIComponent(uri)}`)}
            />
            <InsightsRhythm overview={overview} />
            <InsightsHabits overview={overview} />
            <p className="insights-local-note">{t("analytics.home.localNote")}</p>
          </div>
        )}
    </div>
  );
}
