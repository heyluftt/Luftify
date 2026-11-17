import type { MediaItem } from "@luft/protocol-types";
import { TrackList } from "../../components/TrackList";
import { t } from "../../i18n";
import { SearchSectionHeading } from "./SearchSectionHeading";

type SearchTrackSectionProps = {
  tracks: MediaItem[];
  isSaved: (uri: string) => boolean;
  onSavedChange: (uri: string, saved: boolean) => void;
  onPlay: (uri: string, index: number) => void;
  onQueue?: (uri: string) => void;
  /** Only this many rows, with a way to the full list. */
  limit?: number;
  total?: number;
  onShowAll?: (() => void) | undefined;
};

export function SearchTrackSection({
  tracks,
  isSaved,
  onSavedChange,
  onPlay,
  onQueue,
  limit,
  total = tracks.length,
  onShowAll,
}: SearchTrackSectionProps) {
  if (tracks.length === 0) {
    return null;
  }

  const shown = limit === undefined ? tracks : tracks.slice(0, limit);
  const hasAlbum = shown.some((track) =>
    Boolean(track.albumName?.trim()),
  );
  const hasDuration = shown.some(
    (track) => track.durationMs !== undefined,
  );

  return (
    <section
      className="search-result-section search-track-section"
      aria-labelledby="search-tracks-heading"
    >
      <SearchSectionHeading
        id="search-tracks-heading"
        title={t("search.filter.tracks")}
        count={total}
        onShowAll={onShowAll}
      />

      <div className="search-track-results">
        <TrackList
          tracks={shown}
          compact
          showAlbum={hasAlbum}
          showDuration={hasDuration}
          onPlay={onPlay}
          {...(onQueue ? { onQueue } : {})}
          onSavedChange={onSavedChange}
          saved={isSaved}
        />
      </div>
    </section>
  );
}
