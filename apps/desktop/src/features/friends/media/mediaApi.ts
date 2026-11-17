import { invoke } from "@tauri-apps/api/core";

export type MediaKind = "avatar" | "banner";

/** Mirrors `MediaKind::max_bytes` in luft-listen-together. */
export const MEDIA_MAX_BYTES: Record<MediaKind, number> = { avatar: 2 * 1024 * 1024, banner: 4 * 1024 * 1024 };

const TYPES: Record<string, string> = {
  jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", webm: "video/webm", mp4: "video/mp4",
};

export const mediaType = (id: string) => TYPES[id.split(".").pop() ?? ""] ?? "application/octet-stream";
export const isVideo = (id: string) => mediaType(id).startsWith("video/");

export const mediaApi = {
  /** Raw bytes through IPC; the kind travels as a header. Resolves to the media id. */
  upload: (kind: MediaKind, bytes: Uint8Array) => invoke<string>("friends_upload_media", bytes, { headers: { "x-media-kind": kind } }),
  load: (id: string) => invoke<ArrayBuffer>("friends_media", { id }),
};
