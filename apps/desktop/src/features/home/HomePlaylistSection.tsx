import type { EntitySummary } from "@luft/protocol-types";
import { ChevronRight } from "lucide-react";

import { MediaTile, RowTile } from "../../components/ui/MediaTile";
import { t } from "../../i18n";

/** "quick": compact two-row grid of wide tiles; "shelf": one sideways row of covers. */
type PlaylistSectionVariant = "quick" | "shelf";

interface HomePlaylistSectionProps {
  title: string;
  items: EntitySummary[];
  loading?: boolean;
  variant?: PlaylistSectionVariant;
  getSubtitle?: (item: EntitySummary) => string;
  onOpen: (item: EntitySummary) => void;
  onPlay?: (uri: string) => void;
  showAllLabel?: string;
  onShowAll?: () => void;
}

export function HomePlaylistSection({
  title,
  items,
  loading = false,
  variant = "shelf",
  getSubtitle,
  onOpen,
  onPlay,
  showAllLabel = t("home.showLibrary"),
  onShowAll,
}: HomePlaylistSectionProps) {
  if (!loading && items.length === 0) {
    return null;
  }
  const quick = variant === "quick";
  const subtitleOf = (playlist: EntitySummary) =>
    getSubtitle?.(playlist) ?? playlist.subtitle ?? t("home.playlistFallback");

  return (
    <section className="section-block home-playlist-section">
      <div className="section-title">
        <h2>{title}</h2>
        {onShowAll && (
          <button type="button" className="text-button" onClick={onShowAll}>
            {showAllLabel}
            <ChevronRight size={15} />
          </button>
        )}
      </div>

      <div className={quick ? "home-quick-grid" : "ds-shelf"}>
        {loading &&
          Array.from({ length: quick ? 8 : 6 }, (_, index) => (
            <div className={quick ? "skeleton home-quick-skeleton" : "skeleton home-tile-skeleton"} key={index} />
          ))}

        {items.map((playlist) => {
          const subtitle = subtitleOf(playlist) || undefined;
          const common = {
            title: playlist.name,
            subtitle,
            image: playlist.coverUri,
            openLabel: t("home.openItem", { name: playlist.name }),
            playLabel: t("home.playItem", { name: playlist.name }),
            onOpen: () => onOpen(playlist),
            onPlay: onPlay ? () => onPlay(playlist.uri) : undefined,
          };
          return quick
            ? <RowTile key={playlist.uri} {...common} />
            : <MediaTile key={playlist.uri} {...common} />;
        })}
      </div>
    </section>
  );
}
