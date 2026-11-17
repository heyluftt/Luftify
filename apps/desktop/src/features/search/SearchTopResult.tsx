import { ListPlus, Play } from "lucide-react";
import { useRoomSelectionIntent } from "../listen-together/roomSelectionIntent";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { entitySubtitle, searchKindLabel } from "./searchEntityKind";
import { hitName, type SearchHit } from "./searchRanking";
import { canPlayHit } from "./useSearchHitActions";

export function SearchTopResult({
  hit,
  onOpen,
  onPlay,
}: {
  hit: SearchHit;
  onOpen: (hit: SearchHit) => void;
  onPlay: (hit: SearchHit) => void;
}) {
  const name = hitName(hit);
  const roomIntent = useRoomSelectionIntent();
  const playLabel = hit.kind === "tracks" && roomIntent !== "none"
    ? t(roomIntent === "queue" ? "listen.selection.addName" : "listen.selection.nowName", { name })
    : t("search.play", { name });
  const cover = hit.kind === "tracks" ? hit.track.coverUri : hit.entry.coverUri;
  const detail = hit.kind === "tracks"
    ? hit.track.creators.map((creator) => creator.name).join(", ")
    : hit.kind === "artists" ? "" : entitySubtitle(hit.entry, hit.kind);

  return (
    <section className="search-result-section search-top-result" aria-labelledby="search-top-heading">
      <header className="search-section-heading">
        <h2 id="search-top-heading">{t("search.topResult")}</h2>
      </header>

      <div className={`search-top-card is-${hit.kind}`}>
        <button
          type="button"
          className="search-top-main"
          disabled={hit.kind === "tracks" && roomIntent === "offline"}
          onClick={() => onOpen(hit)}
          aria-label={hit.kind === "tracks" ? playLabel : t("search.open", { name })}
        >
          <span className="search-top-art">
            <AlbumArt title={name} image={cover} size="large" priority />
          </span>
          <strong title={name}>{name}</strong>
          <span className="search-top-meta">
            <em>{searchKindLabel(hit.kind)}</em>
            {detail && <span title={detail}>{detail}</span>}
          </span>
        </button>

        {canPlayHit(hit) && (
          <button
            type="button"
            className="search-top-play"
            disabled={hit.kind === "tracks" && roomIntent === "offline"}
            onClick={() => onPlay(hit)}
            aria-label={playLabel}
            title={playLabel}
          >
            {hit.kind === "tracks" && roomIntent === "queue" ? <ListPlus size={20} aria-hidden="true" /> : <Play size={20} fill="currentColor" aria-hidden="true" />}
          </button>
        )}
      </div>
    </section>
  );
}
