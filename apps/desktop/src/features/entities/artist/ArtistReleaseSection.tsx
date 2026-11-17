import type { ArtistRelease } from "@luft/protocol-types";
import { useNavigate } from "react-router-dom";
import { MediaTile } from "../../../components/ui/MediaTile";
import { t, type MessageKey } from "../../../i18n";

interface ArtistReleaseSectionProps {
  title: string;
  releases: ArtistRelease[];
  fallbackType: MessageKey;
}

export function ArtistReleaseSection({
  title,
  releases,
  fallbackType,
}: ArtistReleaseSectionProps) {
  const navigate = useNavigate();

  if (releases.length === 0) {
    return null;
  }

  return (
    <section className="section-block artist-release-section">
      <div className="section-title">
        <h2>{title}</h2>
        <span className="count-label">{releases.length}</span>
      </div>

      <div className="ds-grid">
        {releases.map((release) => (
          <MediaTile
            key={release.uri}
            title={release.name}
            subtitle={releaseMetadata(release, fallbackType)}
            image={release.coverUri}
            openLabel={t("artist.open", { name: release.name })}
            onOpen={() => navigate(`/album/${encodeURIComponent(release.uri)}`, { state: release })}
          />
        ))}
      </div>
    </section>
  );
}

function releaseMetadata(release: ArtistRelease, fallbackType: MessageKey): string {
  const type = release.subtitle ?? releaseTypeLabel(release, fallbackType);
  const year = release.year ?? (/^\d{4}/.exec(release.releaseDate ?? "")?.[0] || undefined);
  return [year, type].filter(Boolean).join(" · ");
}

function releaseTypeLabel(release: ArtistRelease, fallbackType: MessageKey): string {
  switch (release.releaseType) {
    case "album":
      return t("artist.type.album");
    case "single":
      return t("artist.type.single");
    case "ep":
      return t("artist.type.ep");
    case "compilation":
      return t("artist.type.compilation");
    default:
      return t(fallbackType);
  }
}
