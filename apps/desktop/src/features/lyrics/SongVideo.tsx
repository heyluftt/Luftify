import type { MediaItem } from "@luft/protocol-types";
import { useEffect, useRef, useState, type RefObject } from "react";
import { prefersLessMotion } from "../motion/motionLevel";

interface SongVideoProps {
  onUnavailable: () => void;
  playing: boolean;
  url: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onLoadedData?: () => void;
}

/**
 * The Spotify Canvas to show for `item`, or undefined when disabled, absent
 * or known to be broken. A failed URL stays hidden until the track changes.
 */
export function useSongVideoUrl(item: MediaItem | undefined, enabled: boolean) {
  const [failedUrl, setFailedUrl] = useState<string>();
  useEffect(() => {
    setFailedUrl(undefined);
  }, [item?.uri]);
  const url = enabled && item?.canvasUrl && failedUrl !== item.canvasUrl
    ? item.canvasUrl
    : undefined;
  return {
    url,
    markUnavailable: () => setFailedUrl(url),
  };
}

export function SongVideo({ onUnavailable, playing, url, videoRef: sharedRef, onLoadedData }: SongVideoProps) {
  const ownRef = useRef<HTMLVideoElement>(null);
  const videoRef = sharedRef ?? ownRef;
  const reducedMotion = prefersLessMotion();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncPlayback = () => {
      if (!playing || reducedMotion || document.visibilityState === "hidden") {
        video.pause();
        return;
      }
      void video.play().catch(() => {
        // Autoplay restrictions may leave a still frame; they do not make the
        // Spotify Canvas itself unavailable.
      });
    };
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();
    return () => {
      document.removeEventListener("visibilitychange", syncPlayback);
      video.pause();
    };
  }, [playing, reducedMotion, url, videoRef]);

  return (
    <video
      ref={videoRef}
      className="lyrics-song-video"
      src={url}
      loop
      muted
      playsInline
      preload="metadata"
      disablePictureInPicture
      aria-hidden="true"
      onError={onUnavailable}
      onLoadedData={onLoadedData}
    />
  );
}
