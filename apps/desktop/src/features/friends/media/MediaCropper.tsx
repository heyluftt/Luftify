import { Check, X, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { t } from "../../../i18n";

/** A part of the source in its own pixels. */
export interface Crop { x: number; y: number; width: number; height: number }

const MAX_ZOOM = 3;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Choose the part of a picture or video that fills the frame: drag to move,
 * zoom with the slider or the mouse wheel, arrow keys move in steps. Warns
 * when the chosen part has fewer pixels than the frame will show.
 */
export function MediaCropper({ file, aspect, round, targetWidth, onCancel, onConfirm, onError }: {
  file: File;
  /** Width over height of the frame. */
  aspect: number;
  /** A round frame for the profile picture. */
  round?: boolean;
  /** Pixels across that the result has; less looks soft. */
  targetWidth: number;
  onCancel: () => void;
  onConfirm: (crop: Crop) => void;
  onError?: () => void;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);
  const video = file.type.startsWith("video/");
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [zoom, setZoom] = useState(1);
  // The centre of the chosen part, 0–1 across the source.
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const crop = (() => {
    if (!size) return null;
    const width = Math.min(size.width, size.height * aspect) / zoom;
    const height = width / aspect;
    const x = clamp(center.x * size.width - width / 2, 0, size.width - width);
    const y = clamp(center.y * size.height - height / 2, 0, size.height - height);
    return { x, y, width, height };
  })();
  // Keep the centre where the clamped part actually is.
  const settle = (next: { x: number; y: number }, nextZoom = zoom) => {
    if (!size) return;
    const width = Math.min(size.width, size.height * aspect) / nextZoom;
    const height = width / aspect;
    setCenter({
      x: clamp(next.x, width / 2 / size.width, 1 - width / 2 / size.width),
      y: clamp(next.y, height / 2 / size.height, 1 - height / 2 / size.height),
    });
  };
  const moveBy = (dx: number, dy: number) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || !crop || !size) return;
    // Screen pixels to source pixels, against the drag direction.
    const scale = crop.width / box.width;
    settle({ x: center.x - (dx * scale) / size.width, y: center.y - (dy * scale) / size.height });
  };
  const zoomTo = (value: number) => {
    const next = clamp(value, 1, MAX_ZOOM);
    setZoom(next);
    settle(center, next);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveBy(...move);
  };

  const media = crop && size ? {
    width: `${(size.width / crop.width) * 100}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
  } : { visibility: "hidden" as const };
  const soft = crop ? crop.width < targetWidth * 0.75 : false;

  return <div className="media-cropper">
    <div ref={stage} className="media-cropper-stage" data-round={round || undefined} style={{ aspectRatio: `${aspect}` }}
      role="application" tabIndex={0} aria-label={t("profileLook.cropMove")} onKeyDown={onKey}
      onWheel={(event) => zoomTo(zoom - event.deltaY * 0.0015)}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY }; }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        moveBy(event.clientX - drag.current.x, event.clientY - drag.current.y);
        drag.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}>
      {url && (video
        ? <video src={url} muted loop autoPlay playsInline style={media} aria-hidden="true"
          onLoadedMetadata={(event) => setSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })} />
        : <img src={url} alt="" draggable={false} style={media} onError={onError}
          onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />)}
    </div>
    <div className="media-cropper-zoom">
      <ZoomIn size={15} aria-hidden="true" />
      <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} aria-label={t("profileLook.cropZoom")}
        onChange={(event) => zoomTo(Number(event.currentTarget.value))} />
    </div>
    {soft && <small className="media-cropper-soft">{t("profileLook.cropSoft")}</small>}
    <div className="media-cropper-actions">
      <button type="button" className="secondary-button" onClick={onCancel}><X size={15} aria-hidden="true" />{t("friends.cancel")}</button>
      <button type="button" className="primary-button" disabled={!crop} onClick={() => crop && onConfirm(crop)}>
        <Check size={15} aria-hidden="true" />{t("profileLook.cropApply")}
      </button>
    </div>
  </div>;
}
