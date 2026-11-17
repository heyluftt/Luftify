import { AlertCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "../../i18n";
import { lyricsErrorCode } from "./useLyricsQuery";

export function LyricsState({
  icon,
  title,
  copy,
  spinning = false,
  action,
}: {
  icon: ReactNode;
  title: string;
  copy?: string;
  spinning?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="lyrics-state">
      <span className={spinning ? "spinning" : ""}>
        {icon}
      </span>
      <h2>{title}</h2>
      {copy ? <p>{copy}</p> : null}
      {action ? (
        <button type="button" className="secondary-button" onClick={action.onClick}>
          <RefreshCw size={15} />
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export function LyricsError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const code = lyricsErrorCode(error);
  const missing = code === "LYRICS_NOT_FOUND";
  const pending = code === "LYRICS_LOOKUP_PENDING";
  const invalidMetadata = code === "INVALID_REQUEST";
  const title = missing
    ? t("lyrics.notFound")
    : pending
      ? t("lyrics.searching")
      : invalidMetadata
        ? t("lyrics.incomplete")
        : t("lyrics.unreachable");

  return (
    <LyricsState
      icon={<AlertCircle />}
      title={title}
      {...(!missing && !invalidMetadata
        ? { action: { label: t(pending ? "lyrics.checkAgain" : "lyrics.retry"), onClick: retry } }
        : {})}
    />
  );
}
