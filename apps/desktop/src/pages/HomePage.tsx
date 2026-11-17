import type { EntitySummary } from "@luft/protocol-types";
import { RecapHomeCard } from "../features/recap/RecapHomeCard";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { t } from "../i18n";
import { HomeFeatureCard } from "../features/home/HomeFeatureCard";
import { DiscoverySection } from "../features/discovery/DiscoverySection";
import { HomeListeningSnapshot } from "../features/home/HomeListeningSnapshot";
import { HomePlaylistSection } from "../features/home/HomePlaylistSection";
import {
  greetingForHour,
  homeConnectionLabel,
  homeEntityPath,
} from "../features/home/homeCopy";
import {
  hasPreferredCandidate,
  homeFeatureLabel,
  orderPlaylistsByUsage,
  recentPlaylistDescription,
  resolveHomeFeatureSource,
  selectHomeFeature,
  selectPersonalizedPlaylists,
} from "../features/home/homeFeature";
import { buildHomeShelves } from "../features/home/homeShelves";
import { isReleaseRadar } from "../features/home/homeNames";
import { useHomeNewReleases } from "../features/home/useHomeNewReleases";
import { usePlaylistUsage } from "../features/home/usePlaylistUsage";
import { useReleaseRadarReleases } from "../features/home/useReleaseRadarReleases";
import { playAnalyticsTrack } from "../features/analytics/analyticsPlayback";
import { joinCreatorNames } from "../features/analytics/analyticsFormatting";
import { useListeningOverview } from "../features/analytics/useListeningOverview";
import { usePrefetchInsightArtists } from "../features/analytics/usePrefetchInsightArtists";
import { usePlaylistLibrary } from "../features/library/libraryQueries";
import { libraryPhaseLabel } from "../features/library/libraryState";
import { usePlaybackActions, usePlaybackConnected, usePlaybackSelect } from "../features/playback/usePlayback";
import { deferredPlaybackIntent } from "../features/playback/DeferredPlaybackIntent";
import { desktopApi } from "../services/desktopApi";
import type { PlaylistUsage } from "../types/tauri";

const EMPTY_PLAYLIST_USAGE: PlaylistUsage[] = [];

export function HomePage() {
  const navigate = useNavigate();
  const { command, playUri, playContext } = usePlaybackActions();
  const connected = usePlaybackConnected();
  // Only what the page shows; the position would re-render Home every tick.
  const playback = usePlaybackSelect((current) => ({
    isPlaying: current?.isPlaying ?? false,
    contextUri: current?.contextUri,
    currentItem: current?.currentItem,
  }));
  const playlists = usePlaylistLibrary();
  const settings = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings, staleTime: 30_000 });
  const usage = usePlaylistUsage();
  const analyticsEnabled = settings.data?.listeningAnalyticsEnabled ?? true;
  const listening = useListeningOverview("sevenDays", analyticsEnabled);
  usePrefetchInsightArtists(analyticsEnabled);
  const newReleases = useHomeNewReleases();
  const recommendationPagesRequested = useRef(0);
  const playlistItems = playlists.view.data?.items ?? [];
  const sharedPlaylists = playlistItems.filter(item => item.library?.collaborative === true);
  const featureMode = settings.data?.homeFeatureMode ?? "lastPlayed";
  const livePlaylistUri = playback?.isPlaying && playback.contextUri?.startsWith("spotify:playlist:")
    ? playback.contextUri
    : undefined;
  const usageItems = useMemo(() => {
    const recorded = usage.data ?? EMPTY_PLAYLIST_USAGE;
    if (!livePlaylistUri) return recorded;
    const existing = recorded.find((entry) => entry.playlistUri === livePlaylistUri);
    return [{
      playlistUri: livePlaylistUri,
      playCount: existing?.playCount ?? 1,
      lastPlayedAt: Math.floor(Date.now() / 1_000),
    }, ...recorded.filter((entry) => entry.playlistUri !== livePlaylistUri)];
  }, [livePlaylistUri, usage.data]);
  const fixedPlaylistUri = settings.data?.homeFeaturePlaylistUri ?? undefined;
  const featured = selectHomeFeature(playlistItems, featureMode, usageItems, fixedPlaylistUri);
  const featureSource = featured
    ? resolveHomeFeatureSource(
        featureMode,
        featured,
        usageItems,
        fixedPlaylistUri,
      )
    : "library";
  const deferredPlayKey = useSyncExternalStore(
    deferredPlaybackIntent.subscribe,
    deferredPlaybackIntent.getPendingKey,
    deferredPlaybackIntent.getPendingKey,
  );
  const featuredPlayPending = deferredPlayKey === featured?.uri;
  // The hero doubles as "now playing" for its own playlist; the player bar covers the rest.
  const featuredLive = featured && playback?.currentItem && playback.contextUri === featured.uri
    ? {
        playing: playback.isPlaying,
        track: playback.currentItem.title,
        artists: joinCreatorNames(playback.currentItem.creators),
      }
    : undefined;
  const personalizedCandidates = selectPersonalizedPlaylists(playlistItems)
    .filter((playlist) => playlist.uri !== featured?.uri);
  const personalizedUris = new Set(
    personalizedCandidates.map((playlist) => playlist.uri),
  );
  const usageUris = new Set(usageItems.map((entry) => entry.playlistUri));
  const recent = orderPlaylistsByUsage(playlistItems, usageItems)
    .filter((playlist) => (
      playlist.uri !== featured?.uri
      && !personalizedUris.has(playlist.uri)
      && usageUris.has(playlist.uri)
    ))
    .slice(0, 8);
  const recentItems =
    recent.length > 0
      ? recent
      : playlistItems
          .filter((item) => (
            item.uri !== featured?.uri
            && !personalizedUris.has(item.uri)
          ))
          .slice(0, 8);
  const recentTitle =
    recent.length > 0
      ? t("home.findAgain")
      : t("home.fromLibrary");
  const releaseRadar = playlistItems.find(isReleaseRadar);
  const releaseRadarReleases = useReleaseRadarReleases(
    releaseRadar,
    connected && newReleases.isSuccess && (newReleases.data?.length ?? 0) === 0,
  );
  const releaseItems = (newReleases.data?.length ?? 0) > 0
    ? newReleases.data!
    : releaseRadarReleases.data ?? [];
  const shelves = buildHomeShelves(
    playlistItems,
    new Set(featured?.uri ? [featured.uri] : []),
  );
  const discoveryItems = Array.from(new Map(
    ["radar", "weekly", "repeat", "mixes"]
      .flatMap((id) => shelves.find((shelf) => shelf.id === id)?.items ?? [])
      .map((item) => [item.uri, item] as const),
  ).values()).slice(0, 6);
  const playlistLoading = !playlists.view.data
    && !["unavailable", "error", "offline-cache", "needs-login"].includes(playlists.view.phase);
  const unavailableMessage = !playlists.view.data && !playlistLoading
    ? libraryPhaseLabel(playlists.view.phase)
    : undefined;
  const greeting = greetingForHour(new Date().getHours());
  const openEntity = (item: EntitySummary) => navigate(homeEntityPath(item.uri), { state: item });

  useEffect(() => {
    recommendationPagesRequested.current = 0;
  }, [featureMode, fixedPlaylistUri]);

  useEffect(() => {
    const featureReady = hasPreferredCandidate(
      playlistItems,
      featureMode,
      usageItems,
      fixedPlaylistUri,
    );
    const shelvesReady = shelves.length >= 2 || personalizedCandidates.length >= 3;
    if ((featureReady && shelvesReady)
      || !playlists.remote.hasNextPage
      || playlists.remote.isFetchingNextPage
      || recommendationPagesRequested.current >= 3) return;
    recommendationPagesRequested.current += 1;
    void playlists.remote.fetchNextPage();
  }, [
    featureMode,
    fixedPlaylistUri,
    personalizedCandidates.length,
    shelves.length,
    playlistItems,
    playlists.remote,
    usageItems,
  ]);

  return (
    <div className="page home-page">
      <header className="home-welcome">
        <h1>{greeting}</h1>
        {!connected && (
          <StatusBadge
            state="warning"
            label={homeConnectionLabel(playlists.view.phase)}
          />
        )}
      </header>

      <RecapHomeCard />

      <section className="home-dashboard" aria-label={t("home.overview")}>
        <HomeFeatureCard
          playlist={featured}
          live={featuredLive}
          source={featureSource}
          label={
            featured
              ? homeFeatureLabel(featureSource, featured)
              : undefined
          }
          connected={connected}
          playPending={featuredPlayPending}
          loading={playlistLoading}
          unavailableMessage={unavailableMessage}
          onPlay={playUri}
          onTogglePlayback={() => {
            void command({ command: playback?.isPlaying ? "pause" : "play" });
          }}
          onOpenLyrics={() => navigate("/lyrics")}
          onOpen={openEntity}
          onOpenLibrary={() => navigate("/library")}
        />
      </section>

      <HomePlaylistSection
        variant="quick"
        title={recentTitle}
        items={recentItems}
        loading={playlistLoading}
        getSubtitle={(playlist) => recentPlaylistDescription(playlist, usageItems)}
        onOpen={openEntity}
        onPlay={playUri}
        onShowAll={() => navigate("/library")}
      />

      <DiscoverySection analyticsEnabled={analyticsEnabled} />

      {discoveryItems.length > 0 && (
        <HomePlaylistSection
          title={t("home.spotifyMixes")}
          items={discoveryItems}
          getSubtitle={() => ""}
          onOpen={openEntity}
          onPlay={playUri}
        />
      )}

      {releaseItems.length > 0 && (
        <HomePlaylistSection
          title={t("home.releasesTitle")}
          items={releaseItems.slice(0, 6)}
          getSubtitle={(release) => release.subtitle?.trim() || t("home.newMusic")}
          onOpen={openEntity}
          onPlay={playUri}
        />
      )}

      {sharedPlaylists.length > 0 && (
        <HomePlaylistSection
          title={t("playlists.sharedShelf")}
          items={sharedPlaylists}
          getSubtitle={() => t("playlists.sharedKind")}
          onOpen={openEntity}
          onPlay={playUri}
          onShowAll={() => navigate("/library")}
        />
      )}

      <HomeListeningSnapshot
        enabled={analyticsEnabled}
        error={analyticsEnabled && listening.query.isError}
        loading={settings.isLoading || (analyticsEnabled && listening.query.isLoading)}
        overview={listening.query.data}
        onOpen={() => navigate("/insights")}
        onOpenSettings={() => navigate("/settings")}
        onPlayTrack={(track) => playAnalyticsTrack(track, { playContext, playUri })}
      />
    </div>
  );
}
