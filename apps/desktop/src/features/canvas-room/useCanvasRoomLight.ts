import { useEffect, useRef, type RefObject } from "react";

/** A small projection of the existing decoder, never a second video stream.
 * Blur happens on 320 × 180 pixels, not on a full-resolution desktop layer.
 * No pixel reads or exports: cross-origin Canvas videos can still be drawn.
 */
export function useCanvasRoomLight(videoRef: RefObject<HTMLVideoElement | null>, url?: string) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !video || !url) return;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    let timer: number | undefined;
    let failed = false;
    let lastTime = -1;
    const stop = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const paint = () => {
      stop();
      if (failed || document.visibilityState === "hidden") return;
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight && video.currentTime !== lastTime) {
        try {
          // Overscan hides blur edges; preserve proportions in the projection too.
          const scale = Math.max(384 / video.videoWidth, 244 / video.videoHeight);
          const width = video.videoWidth * scale;
          const height = video.videoHeight * scale;
          context.filter = "blur(18px) saturate(1.35)";
          context.drawImage(video, (320 - width) / 2, (180 - height) / 2, width, height);
          canvas.style.opacity = "1";
          lastTime = video.currentTime;
        } catch {
          // A renderer limitation must never stop the foreground Canvas.
          failed = true;
          canvas.style.opacity = "0";
        }
      }
      if (!video.paused && !video.ended && !failed) timer = window.setTimeout(paint, 125);
    };
    const events = ["loadeddata", "seeked", "play", "pause"] as const;
    for (const event of events) video.addEventListener(event, paint);
    document.addEventListener("visibilitychange", paint);
    paint();
    return () => {
      stop();
      for (const event of events) video.removeEventListener(event, paint);
      document.removeEventListener("visibilitychange", paint);
      canvas.style.opacity = "0";
    };
  }, [videoRef, url]);

  return canvasRef;
}
