import type { MediaItem } from "@luft/protocol-types";
import { useRef, type MouseEventHandler } from "react";
import { Link } from "react-router-dom";

import { AlbumArt } from "../../components/AlbumArt";
import { ArtistLinks } from "../../components/entity/ArtistLinks";
import { t } from "../../i18n";
import type { LyricsVisualSettings } from "../../types/tauri";
import { albumDestination } from "../entities/mediaDestinations";
import { LyricsArtworkAmbient } from "./LyricsArtworkAmbient";
import { SongVideo, useSongVideoUrl } from "./SongVideo";
import { useTitleFit } from "./useTitleFit";

export interface LyricsCoverViewProps {
  connected: boolean;
  item: MediaItem | undefined;
  onContextMenu: MouseEventHandler<HTMLElement>;
  playing: boolean;
  songVideosEnabled: boolean;
  visualSettings: LyricsVisualSettings;
}

export function LyricsCoverView({
  connected,
  item,
  onContextMenu,
  playing,
  songVideosEnabled,
  visualSettings,
}: LyricsCoverViewProps) {
  const video = useSongVideoUrl(item, songVideosEnabled);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const title = item?.title ?? t("lyrics.noTrack");
  useTitleFit(titleRef, title);
  const albumName = item?.albumName?.trim();
  const album = item ? albumDestination(item) : undefined;
  const showAlbum = Boolean(
    albumName && normalizeLabel(albumName) !== normalizeLabel(title),
  );
  const playbackLabel = item
    ? !connected
      ? t("lyrics.disconnected")
      : playing
        ? t("lyrics.playing")
        : t("lyrics.paused")
    : undefined;

  return (
    <section
      className={`lyrics-cover-view${item ? "" : " is-empty"}`}
      onContextMenu={onContextMenu}
      aria-label={t("lyrics.coverView", { title })}
    >
      <div className="lyrics-cover-backdrop" aria-hidden="true">
        <div className="lyrics-cover-backdrop-art">
          <AlbumArt
            title={title}
            size="feature"
            image={item?.coverUri}
          />
        </div>
      </div>

      <div className="lyrics-cover-content" key={item?.uri ?? "empty"}>
        <div className="lyrics-cover-visual">
          <div className={`lyrics-cover-artwork${video.url ? " has-song-video" : ""}`}>
            <LyricsArtworkAmbient
              image={item?.coverUri}
              playing={playing}
              settings={visualSettings}
              title={title}
            />
            <AlbumArt
              title={title}
              size="feature"
              image={item?.coverUri}
            />
            {video.url && (
              <SongVideo
                url={video.url}
                playing={playing}
                onUnavailable={video.markUnavailable}
              />
            )}
          </div>
        </div>

        <div className="lyrics-cover-copy">
          {playbackLabel && (
            <span className="lyrics-cover-kicker">
              <span
                className={`lyrics-cover-status-dot${playing && connected ? " is-playing" : ""}`}
                aria-hidden="true"
              />
              {playbackLabel}
            </span>
          )}

          <h1 ref={titleRef} className="lyrics-cover-title" title={title}>
            {title}
          </h1>
          <div className="lyrics-cover-meta">
            <ArtistLinks
              className="lyrics-cover-artists"
              creators={item?.creators}
              fallback={t("lyrics.startSong")}
            />

            {showAlbum && albumName && album && (
              <Link
                className="lyrics-cover-album"
                to={album.path}
                state={album.summary}
                title={albumName}
                aria-label={t("lyrics.openAlbum", { name: album.label })}
              >
                {albumName}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function normalizeLabel(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
