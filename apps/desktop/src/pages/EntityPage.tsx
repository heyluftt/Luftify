import type { EntitySummary } from "@luft/protocol-types";
import { useLocation, useParams } from "react-router-dom";
import { AlbumView } from "../features/entities/AlbumView";
import { ArtistView } from "../features/entities/ArtistView";
import { PlaylistView } from "../features/entities/PlaylistView";
import type { EntityKind } from "../features/entities/entityTypes";

export function EntityPage({ kind }: { kind: EntityKind }) {
  const location = useLocation();
  const { uri = "" } = useParams();
  const decodedUri = decodeURIComponent(uri);
  const summary = location.state as EntitySummary | undefined;

  return (
    <div className="page entity-page">

      {kind === "Playlist" ? (
        <PlaylistView uri={decodedUri} summary={summary} />
      ) : kind === "Album" ? (
        <AlbumView uri={decodedUri} summary={summary} />
      ) : (
        <ArtistView uri={decodedUri} summary={summary} />
      )}
    </div>
  );
}
