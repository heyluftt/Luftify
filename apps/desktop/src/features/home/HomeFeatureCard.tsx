import type { EntitySummary } from "@luft/protocol-types";
import {
  ArrowRight,
  Clock3,
  Headphones,
  Library,
  MicVocal,
  Pause,
  Pin,
  Play,
  Sparkles,
} from "lucide-react";

import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import type { HomeFeatureSource } from "./homeFeature";
import { HomeFeatureSleeve, HomeLiveBars } from "./HomeFeatureSleeve";
import { useCoverTint } from "../theme/useCoverTint";

/** Set when the featured playlist is the active playback context. */
export interface HomeFeatureLive {
  playing: boolean;
  track: string;
  artists: string;
}

interface HomeFeatureCardProps {
  playlist: EntitySummary | undefined;
  live?: HomeFeatureLive | undefined;
  source: HomeFeatureSource;
  label: string | undefined;
  connected: boolean;
  playPending: boolean;
  loading: boolean;
  unavailableMessage?: string | undefined;
  onPlay: (uri: string) => void | Promise<void>;
  onTogglePlayback: () => void;
  onOpenLyrics: () => void;
  onOpen: (playlist: EntitySummary) => void;
  onOpenLibrary: () => void;
}

export function HomeFeatureCard({
  playlist,
  live,
  source,
  label,
  connected,
  playPending,
  loading,
  unavailableMessage,
  onPlay,
  onTogglePlayback,
  onOpenLyrics,
  onOpen,
  onOpenLibrary,
}: HomeFeatureCardProps) {
  const tint = useCoverTint(playlist?.coverUri);
  if (!playlist) {
    return (
      <article className="home-feature">
        <div
          className={[
            "feature-placeholder",
            loading ? "loading" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="feature-placeholder-art" aria-hidden="true">
            <Library size={28} />
          </div>
          <div>
            <span className="feature-kicker">
              <Clock3 size={13} />
              {loading ? t("home.loading") : t("nav.library")}
            </span>
            <h2>
              {loading ? t("library.playlists") : t("library.yours")}
            </h2>
            {!loading && unavailableMessage && (
              <p>{unavailableMessage}</p>
            )}
            <button
              type="button"
              className="text-button home-feature-open"
              onClick={onOpenLibrary}
            >
              {t("library.open")}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </article>
    );
  }

  const FeatureIcon = featureIcon(source);

  return (
    <article className={`home-feature${tint ? " is-tinted" : ""}`} style={tint}>
      {playlist.coverUri && (
        <div className="home-feature-backdrop" aria-hidden="true">
          <AlbumArt
            title={playlist.name}
            size="feature"
            image={playlist.coverUri}
          />
        </div>
      )}
      <HomeFeatureSleeve
        title={playlist.name}
        image={playlist.coverUri}
        live={Boolean(live)}
        playing={Boolean(live?.playing)}
      />

      <div className="home-feature-copy">
        <span className="feature-kicker">
          {live
            ? <HomeLiveBars playing={live.playing} />
            : <FeatureIcon size={13} />}
          {live ? t(live.playing ? "home.nowPlaying" : "home.paused") : label}
        </span>
        <h2 title={playlist.name}>{playlist.name}</h2>
        {live && (
          <p className="home-feature-track" title={`${live.track} · ${live.artists}`}>
            <strong>{live.track}</strong> · {live.artists}
          </p>
        )}

        <div className="feature-actions">
          <button
            type="button"
            className="primary-button"
            aria-live="polite"
            onClick={() => (live ? onTogglePlayback() : onPlay(playlist.uri))}
          >
            {live?.playing
              ? <Pause size={15} fill="currentColor" />
              : <Play size={15} fill="currentColor" />}
            {live
              ? t(live.playing ? "home.pause" : "home.resume")
              : playPending
                ? t("home.waitConnection")
                : connected
                  ? t("home.play")
                  : t("home.playAfterConnect")}
          </button>
          {live && (
            <button type="button" className="text-button home-feature-open" onClick={onOpenLyrics}>
              <MicVocal size={15} />
              {t("home.lyrics")}
            </button>
          )}
          <button
            type="button"
            className="text-button home-feature-open"
            onClick={() => onOpen(playlist)}
          >
            {t("home.openPlaylist")}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

function featureIcon(source: HomeFeatureSource) {
  if (source === "mostPlayed") return Headphones;
  if (source === "personalized") return Sparkles;
  if (source === "fixed") return Pin;
  if (source === "library") return Library;
  return Clock3;
}
