import { useEffect, useRef, useState } from "react";
import { isVideo } from "./mediaApi";
import { useMediaUrl } from "./useMediaUrl";
import { prefersLessMotion } from "../../motion/motionLevel";

/** Hidden, minimised or with reduced motion, videos hold still (windowActivity.ts). */
function useMayMove() {
  const read = () => !document.documentElement.hasAttribute("data-window-idle")
    && !prefersLessMotion();
  const [may, setMay] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setMay(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-window-idle"] });
    return () => observer.disconnect();
  }, []);
  return may;
}

/**
 * A profile's moving picture or banner: an image (GIF, WebP, JPG, PNG) or a
 * muted looping video. Paused videos show their first frame.
 */
export function MotionMedia({ id, playing = true, className }: { id: string; playing?: boolean; className?: string }) {
  const url = useMediaUrl(id);
  const video = useRef<HTMLVideoElement>(null);
  const mayMove = useMayMove();
  const moving = playing && mayMove;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (moving) void element.play().catch(() => undefined);
    else element.pause();
  }, [moving, url]);
  if (!url) return null;
  if (!isVideo(id)) return <img className={className} src={url} alt="" aria-hidden="true" draggable={false} />;
  return <video ref={video} className={className} src={url} muted loop playsInline preload="auto" aria-hidden="true"
    disablePictureInPicture disableRemotePlayback />;
}
