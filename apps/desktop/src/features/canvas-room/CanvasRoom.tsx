import type { MediaItem } from "@luft/protocol-types";
import type { LyricsLine } from "../../types/tauri";
import { useRef, useState, type MouseEventHandler } from "react";
import { AlbumArt } from "../../components/AlbumArt";
import { ArtistLinks } from "../../components/entity/ArtistLinks";
import { t } from "../../i18n";
import { SongVideo, useSongVideoUrl } from "../lyrics/SongVideo";
import { CanvasRoomLyrics } from "./CanvasRoomLyrics";
import { useCanvasRoomLight } from "./useCanvasRoomLight";

interface CanvasRoomProps {
  item: MediaItem | undefined;
  connected: boolean;
  playing: boolean;
  songVideosEnabled: boolean;
  onContextMenu: MouseEventHandler<HTMLElement>;
  /** Lyrics on the left; absent when there are none or they are switched off. */
  lyrics?: { lines: LyricsLine[]; activeIndex: number; synced: boolean; onSeek: (line: LyricsLine) => void } | undefined;
}

export function CanvasRoom({ item, connected, playing, songVideosEnabled, onContextMenu, lyrics }: CanvasRoomProps) {
  const video = useSongVideoUrl(item, songVideosEnabled);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lightRef = useCanvasRoomLight(videoRef, video.url);
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const [shape, setShape] = useState<VideoShape>();
  const ready = Boolean(video.url && loadedUrl === video.url);
  const title = item?.title ?? t("lyrics.noTrack");
  const status = !item ? t("lyrics.startSong") : !connected
    ? t("lyrics.disconnected") : playing ? t("lyrics.playing") : t("lyrics.paused");

  return (
    <section
      className={`canvas-room${ready ? " has-video" : ""}${playing ? " is-playing" : ""}${lyrics ? " has-lyrics" : ""}`}
      data-shape={ready ? shape : undefined}
      aria-label={t("lyrics.roomView", { title })}
      onContextMenu={onContextMenu}
    >
      <div className="canvas-room-light" aria-hidden="true">
        <div className="canvas-room-art-light">
          <AlbumArt image={item?.coverUri} title={title} size="medium" priority />
        </div>
        <canvas ref={lightRef} width={320} height={180} />
      </div>
      <div className="canvas-room-horizon" aria-hidden="true" />
      <div className="canvas-room-scene">
        <div className="canvas-room-visual">
          <div className="canvas-room-cover" aria-hidden={ready}>
            <AlbumArt image={item?.coverUri} title={title} size="feature" priority />
          </div>
          {video.url && (
            <SongVideo
              key={video.url}
              videoRef={videoRef}
              url={video.url}
              playing={playing}
              onUnavailable={video.markUnavailable}
              onLoadedData={() => {
                setLoadedUrl(video.url);
                setShape(videoShape(videoRef.current));
              }}
            />
          )}
        </div>
      </div>
      {lyrics && <CanvasRoomLyrics {...lyrics} />}
      <div className="canvas-room-copy">
        <div className="canvas-room-eyebrow">
          <span className="canvas-room-pulse" aria-hidden="true" />
          {status}
        </div>
        <h1 title={title}>{title}</h1>
        <ArtistLinks creators={item?.creators} fallback={t("lyrics.startSong")} />
        {ready && (
          <div className="canvas-room-record" aria-hidden="true">
            <AlbumArt image={item?.coverUri} title={title} size="small" priority />
            <span>{item?.albumName ?? title}</span>
          </div>
        )}
      </div>
      <span className="canvas-room-signature" aria-hidden="true">{t("lyrics.roomName")}</span>
    </section>
  );
}

type VideoShape = "portrait" | "square" | "wide";

/** A tall canvas leaves room beside it; the room then gives the lyrics more width. */
function videoShape(video: HTMLVideoElement | null): VideoShape | undefined {
  if (!video?.videoWidth || !video.videoHeight) return undefined;
  const ratio = video.videoWidth / video.videoHeight;
  return ratio < 0.8 ? "portrait" : ratio > 1.3 ? "wide" : "square";
}
