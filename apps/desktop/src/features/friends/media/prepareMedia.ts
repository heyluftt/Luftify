/**
 * Turns a chosen file into what the server stores. Pictures are cropped and
 * shrunk, videos are re-encoded to a short, silent WebM in the right shape,
 * GIFs and animated WebPs stay as they are (they cannot be re-encoded here).
 * A moving picture also yields its first frame as the still avatar, which
 * lists and older apps show.
 */
import { logClientError } from "../../../services/clientLog";
import type { Crop } from "./MediaCropper";
import { MEDIA_MAX_BYTES, type MediaKind } from "./mediaApi";

export type PrepareError = "type" | "size" | "video";
export class PrepareFailure extends Error {
  constructor(readonly reason: PrepareError) { super(reason); }
}

export interface PreparedMedia {
  bytes: Uint8Array;
  /** The still avatar (inline JPEG) for a moving picture. */
  poster?: string;
}

const STILL_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
/** Videos are cut to this length; longer clips loop worse anyway. */
const VIDEO_SECONDS = 8;
/** What a picked file may weigh before it is processed. */
const MAX_INPUT_BYTES = 200 * 1024 * 1024;

interface Shape { width: number; height: number; bitrate: number }

/** The largest result; smaller sources are never scaled up. */
export const SHAPES: Record<MediaKind, Shape> = {
  avatar: { width: 320, height: 320, bitrate: 900_000 },
  banner: { width: 1500, height: 500, bitrate: 2_000_000 },
};

/** Whether a file can be cropped here (GIFs and animated WebPs cannot be re-encoded). */
export async function croppable(file: File): Promise<boolean> {
  return VIDEO_TYPES.includes(file.type) || (STILL_TYPES.includes(file.type) && !(file.type === "image/webp" && await animatedWebp(file)));
}

/** For the file dialogs of picture and banner. */
export const MEDIA_ACCEPT = [...STILL_TYPES, "image/gif", ...VIDEO_TYPES].join(",");

/** Whether a picked image is a still one (then it is the inline avatar as before). */
export async function isStillImage(file: File): Promise<boolean> {
  return STILL_TYPES.includes(file.type) && !(file.type === "image/webp" && await animatedWebp(file));
}

export async function prepareMedia(kind: MediaKind, file: File, crop?: Crop): Promise<PreparedMedia> {
  if (file.size > MAX_INPUT_BYTES) throw new PrepareFailure("size");
  try {
    return await prepare(kind, file, crop);
  } catch (error) {
    if (error instanceof PrepareFailure) throw error;
    // Anything unexpected (a codec, the recorder) goes to the log and reads as unusable.
    logClientError("profileMedia", error);
    throw new PrepareFailure(VIDEO_TYPES.includes(file.type) ? "video" : "type");
  }
}

async function prepare(kind: MediaKind, file: File, crop?: Crop): Promise<PreparedMedia> {
  const shape = SHAPES[kind];
  if (VIDEO_TYPES.includes(file.type)) return checked(kind, await transcode(file, shape, kind === "avatar", crop));
  if (file.type === "image/gif" || (file.type === "image/webp" && await animatedWebp(file))) {
    const bytes = checked(kind, { bytes: new Uint8Array(await file.arrayBuffer()) }).bytes;
    return { bytes, ...(kind === "avatar" ? { poster: await still(file) } : {}) };
  }
  if (kind === "banner" && STILL_TYPES.includes(file.type)) return checked(kind, { bytes: await shrink(file, shape, crop) });
  throw new PrepareFailure("type");
}

function checked(kind: MediaKind, media: PreparedMedia): PreparedMedia {
  if (media.bytes.length > MEDIA_MAX_BYTES[kind]) throw new PrepareFailure("size");
  return media;
}

/** VP8X header with the animation flag. */
async function animatedWebp(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const text = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  return text(0, 4) === "RIFF" && text(8, 12) === "WEBP" && text(12, 16) === "VP8X" && ((head[20] ?? 0) & 0x02) !== 0;
}

/** Where to cut the source so it fills the target shape. */
function cover(sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const w = width / scale;
  const h = height / scale;
  return [(sourceWidth - w) / 2, (sourceHeight - h) / 2, w, h] as const;
}

/** The chosen part, or the middle; and the output size, never above the source's pixels. */
function framing(sourceWidth: number, sourceHeight: number, shape: Shape, crop?: Crop) {
  const part = crop ? [crop.x, crop.y, crop.width, crop.height] as const : cover(sourceWidth, sourceHeight, shape.width, shape.height);
  const scale = Math.min(1, part[2] / shape.width);
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return {
    part,
    width: even(shape.width * scale),
    height: even(shape.height * scale),
    bitrate: Math.max(300_000, Math.round(shape.bitrate * scale * scale)),
  };
}

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (!context) throw new PrepareFailure("type");
  return { element, context };
}

const blobBytes = async (blob: Blob | null) => {
  if (!blob) throw new PrepareFailure("type");
  return new Uint8Array(await blob.arrayBuffer());
};

/** A small JPEG of the first frame, like the still avatar (profileImage.ts). */
function posterFrom(source: CanvasImageSource, width: number, height: number): string {
  const { element, context } = canvas(96, 96);
  context.drawImage(source, ...cover(width, height, 96, 96), 0, 0, 96, 96);
  for (const quality of [0.8, 0.65, 0.5]) {
    const data = element.toDataURL("image/jpeg", quality);
    if (data.length <= 20_000) return data;
  }
  throw new PrepareFailure("size");
}

async function decoded(file: Blob) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new PrepareFailure("type");
  } finally {
    URL.revokeObjectURL(url);
  }
  if (!image.naturalWidth || !image.naturalHeight) throw new PrepareFailure("type");
  return image;
}

async function still(file: Blob): Promise<string> {
  const image = await decoded(file);
  return posterFrom(image, image.naturalWidth, image.naturalHeight);
}

async function shrink(file: Blob, shape: Shape, crop?: Crop): Promise<Uint8Array> {
  const image = await decoded(file);
  const { part, width, height } = framing(image.naturalWidth, image.naturalHeight, shape, crop);
  const { element, context } = canvas(width, height);
  context.drawImage(image, ...part, 0, 0, width, height);
  return blobBytes(await new Promise<Blob | null>((resolve) => element.toBlob(resolve, "image/webp", 0.86)));
}

const once = (target: EventTarget, name: string) => new Promise<void>((resolve, reject) => {
  target.addEventListener(name, () => resolve(), { once: true });
  target.addEventListener("error", () => reject(new PrepareFailure("video")), { once: true });
});

/**
 * Plays the clip once into a canvas of the target shape and records that:
 * the result has no sound, the right size and a small, steady bitrate.
 */
async function transcode(file: File, shape: Shape, withPoster: boolean, crop?: Crop): Promise<PreparedMedia> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await once(video, "loadeddata");
    if (!video.videoWidth || !video.videoHeight) throw new PrepareFailure("video");
    const { part, width, height, bitrate } = framing(video.videoWidth, video.videoHeight, shape, crop);
    const { element, context } = canvas(width, height);
    const draw = () => context.drawImage(video, ...part, 0, 0, width, height);
    draw();
    const poster = withPoster ? posterFrom(element, width, height) : undefined;
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!type) throw new PrepareFailure("video");
    const recorder = new MediaRecorder(element.captureStream(30), { mimeType: type, videoBitsPerSecond: bitrate });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    const end = Math.min(VIDEO_SECONDS, Number.isFinite(video.duration) && video.duration > 0 ? video.duration : VIDEO_SECONDS);
    recorder.start(250);
    await video.play().catch(() => { throw new PrepareFailure("video"); });
    // A timer, not animation frames: those stop when the window is covered.
    // A clip that stops playing (hidden window, broken file) ends the
    // recording after a while; what was recorded until then is kept.
    const deadline = performance.now() + end * 1000 + 4000;
    await new Promise<void>((resolve) => {
      const frame = () => {
        draw();
        if (video.ended || video.currentTime >= end || performance.now() > deadline) return resolve();
        window.setTimeout(frame, 1000 / 30);
      };
      frame();
    });
    if (video.currentTime < 0.5) { recorder.stop(); throw new PrepareFailure("video"); }
    video.pause();
    recorder.stop();
    await stopped;
    const bytes = await blobBytes(new Blob(chunks, { type: "video/webm" }));
    return { bytes, ...(poster ? { poster } : {}) };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
