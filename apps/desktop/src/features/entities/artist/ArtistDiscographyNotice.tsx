import { t } from "../../../i18n";
import { CircleAlert, RefreshCw } from "lucide-react";
import type { ArtistDiscographyIssue } from "./artistProfileModel";

interface ArtistDiscographyNoticeProps {
  issues: ArtistDiscographyIssue[];
  onRetry: () => void;
}

export function ArtistDiscographyNotice({
  issues,
  onRetry,
}: ArtistDiscographyNoticeProps) {
  if (issues.length === 0) return null;

  const description = issues
    .map((issue) =>
      t(issue.status === "failed" ? "artist.discography.failed" : "artist.discography.unsupported", { label: issue.label }),
    )
    .join(" ");

  return (
    <section className="artist-profile-status partial" role="status">
      <span className="artist-profile-status-icon" aria-hidden="true">
        <CircleAlert size={20} />
      </span>
      <div>
        <h2>{t("artist.discography.incomplete")}</h2>
        <p>{description}</p>
      </div>
      <button type="button" className="secondary-button" onClick={onRetry}>
        <RefreshCw size={15} aria-hidden="true" />
        {t("artist.status.retry")}
      </button>
    </section>
  );
}
