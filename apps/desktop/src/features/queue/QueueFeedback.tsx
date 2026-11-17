import { t } from "../../i18n";
import {
  CircleAlert,
  ListMusic,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

type QueueFeedbackKind =
  | "connecting"
  | "loading"
  | "unavailable"
  | "error"
  | "empty";

interface QueueFeedbackProps {
  kind: QueueFeedbackKind;
  compact?: boolean;
  onRetry?: (() => void) | undefined;
}

function feedbackCopy(kind: QueueFeedbackKind): { title: string; detail?: string } {
  if (kind === "unavailable") {
    return { title: t("queue.feedback.unavailable"), detail: t("queue.feedback.unavailableDetail") };
  }
  return { title: t(`queue.feedback.${kind}`) };
}

export function QueueFeedback({
  kind,
  compact = false,
  onRetry,
}: QueueFeedbackProps) {
  const copy = feedbackCopy(kind);
  const loading = kind === "connecting" || kind === "loading";

  return (
    <div
      className={[
        "queue-feedback",
        compact ? "queue-panel-empty" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role={loading ? "status" : "group"}
      aria-live={loading ? "polite" : undefined}
    >
      <span className="queue-feedback-icon" aria-hidden="true">
        {loading ? (
          <LoaderCircle className="queue-track-spinner" size={21} />
        ) : kind === "empty" ? (
          <ListMusic size={21} />
        ) : (
          <CircleAlert size={21} />
        )}
      </span>

      <h2 className="queue-feedback-title">{copy.title}</h2>
      {copy.detail && <p className="queue-feedback-copy">{copy.detail}</p>}

      {onRetry && (
        <button
          type="button"
          className="queue-refresh-button"
          onClick={onRetry}
        >
          <RefreshCw size={15} />
          <span>{t("queue.retry")}</span>
        </button>
      )}
    </div>
  );
}
