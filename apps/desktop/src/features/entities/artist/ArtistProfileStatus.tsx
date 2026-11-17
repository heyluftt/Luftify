import { t, type MessageKey } from "../../../i18n";
import {
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  Unplug,
} from "lucide-react";

type ArtistProfileStatusKind =
  | "connecting"
  | "loading"
  | "missing-capability"
  | "partial-releases"
  | "partial-tracks"
  | "error";

interface ArtistProfileStatusProps {
  kind: ArtistProfileStatusKind;
  onRetry?: (() => void) | undefined;
}

const CONTENT: Record<ArtistProfileStatusKind, { title: MessageKey; description?: MessageKey }> = {
  connecting: { title: "artist.status.connecting", description: "artist.status.connectingHint" },
  loading: { title: "artist.status.loading" },
  "missing-capability": { title: "artist.status.missing", description: "artist.status.missingHint" },
  "partial-releases": { title: "artist.status.partialReleases", description: "artist.status.partialHint" },
  "partial-tracks": { title: "artist.status.partialTracks", description: "artist.status.partialHint" },
  error: { title: "artist.status.error", description: "artist.status.errorHint" },
};

export function ArtistProfileStatus({
  kind,
  onRetry,
}: ArtistProfileStatusProps) {
  const content = CONTENT[kind];
  const isPending = kind === "connecting" || kind === "loading";
  const isPartial = kind === "partial-releases" || kind === "partial-tracks";
  const Icon = isPending
    ? LoaderCircle
    : kind === "missing-capability"
      ? Unplug
      : CircleAlert;

  return (
    <section
      className={`artist-profile-status ${isPending ? "pending" : ""} ${isPartial ? "partial" : ""}`}
      role={isPending || isPartial ? "status" : "alert"}
    >
      <span className="artist-profile-status-icon" aria-hidden="true">
        <Icon className={isPending ? "spin" : ""} size={20} />
      </span>
      <div>
        <h2>{t(content.title)}</h2>
        {content.description && <p>{t(content.description)}</p>}
      </div>
      {onRetry && (
        <button type="button" className="secondary-button" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />
          {t("artist.status.retry")}
        </button>
      )}
    </section>
  );
}
