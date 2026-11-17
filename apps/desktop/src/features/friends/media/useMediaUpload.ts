import { useEffect, useRef, useState } from "react";
import { t, type MessageKey } from "../../../i18n";
import { logClientError } from "../../../services/clientLog";
import { friendsErrorText } from "../useFriends";
import { mediaApi, type MediaKind } from "./mediaApi";
import type { Crop } from "./MediaCropper";
import { PrepareFailure, prepareMedia } from "./prepareMedia";

export type UploadPhase = "idle" | "preparing" | "uploading";

function errorText(error: unknown): string {
  if (error instanceof PrepareFailure) return t(`profileLook.error.${error.reason}` as MessageKey);
  const raw = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  if (raw === "friends.error.limitReached") return t("profileLook.error.limit");
  if (!raw.startsWith("friends.error.")) logClientError("profileMediaUpload", error);
  return friendsErrorText(error) ?? t("friends.error.generic");
}

/**
 * Prepares and uploads one picked file at a time. Picking again or leaving
 * the editor drops the result of an earlier pick.
 */
export function useMediaUpload() {
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);

  const upload = async (kind: MediaKind, file: File, crop?: Crop): Promise<{ id: string; poster?: string } | null> => {
    const attempt = ++generation.current;
    const live = () => attempt === generation.current;
    setError(undefined);
    setPhase("preparing");
    try {
      const media = await prepareMedia(kind, file, crop);
      if (!live()) return null;
      setPhase("uploading");
      const id = await mediaApi.upload(kind, media.bytes);
      if (!live()) return null;
      setPhase("idle");
      return { id, ...(media.poster ? { poster: media.poster } : {}) };
    } catch (failure) {
      if (live()) { setPhase("idle"); setError(errorText(failure)); }
      return null;
    }
  };
  const reset = () => { generation.current++; setPhase("idle"); setError(undefined); };
  return { phase, error, upload, reset, fail: (message: string) => { reset(); setError(message); } };
}
