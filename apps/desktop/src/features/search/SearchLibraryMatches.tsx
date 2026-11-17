import type { EntitySummary } from "@luft/protocol-types";
import { LibraryBig } from "lucide-react";
import { useMemo } from "react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { usePlaylistLibrary } from "../library/libraryQueries";
import { matchLibraryPlaylists } from "./searchRanking";

/**
 * Own playlists matching the query, straight from the loaded library: they
 * show up before Spotify answers and need no network.
 */
export function SearchLibraryMatches({
  query,
  onOpen,
}: {
  query: string;
  onOpen: (playlist: EntitySummary) => void;
}) {
  const library = usePlaylistLibrary();
  const playlists = library.view.data?.items;
  const matches = useMemo(
    () => matchLibraryPlaylists(playlists ?? [], query),
    [playlists, query],
  );

  if (matches.length === 0) return null;

  return (
    <section className="search-library-matches" aria-labelledby="search-library-heading">
      <h2 id="search-library-heading">
        <LibraryBig size={14} aria-hidden="true" />
        {t("search.inLibrary")}
      </h2>
      <div>
        {matches.map((playlist) => (
          <button
            type="button"
            key={playlist.uri}
            onClick={() => onOpen(playlist)}
            aria-label={t("search.open", { name: playlist.name })}
          >
            <AlbumArt title={playlist.name} image={playlist.coverUri} size="tiny" />
            <span title={playlist.name}>{playlist.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
