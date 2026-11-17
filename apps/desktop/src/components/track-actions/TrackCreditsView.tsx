import type { MediaItem } from "@luft/protocol-types";
import { Disc3, ExternalLink, User } from "lucide-react";
import { albumDestination } from "../../features/entities/mediaDestinations";
import { formatTrackDuration, openExternalUrl } from "../../features/entities/spotifyLinks";
import { t } from "../../i18n";
import { artistDestination } from "../entity/ArtistLinks";
import type { RunTrackAction, TrackMenuNavigate } from "./trackActionTypes";

export function TrackCreditsView({ track, webUrl, runAction, go, onBack }: {
  track: MediaItem;
  webUrl: string | undefined;
  runAction: RunTrackAction;
  go: TrackMenuNavigate;
  onBack: () => void;
}) {
  const album = albumDestination(track);
  const creators = track.creators.filter((creator) => creator.name.trim());

  return (
    <div className="track-actions-submenu">
      <button type="button" className="track-actions-back" onClick={onBack}>{t("trackActions.back")}</button>
      <div className="track-actions-credits">
        <p className="track-actions-credits-label">{t("trackActions.creditsArtists")}</p>
        {creators.length === 0 ? (
          <p className="track-actions-hint">{t("trackActions.creditsEmpty")}</p>
        ) : creators.map((creator, index) => {
          const destination = artistDestination(creator);
          return (
            <button
              type="button"
              key={`${creator.uri ?? creator.name}:${index}`}
              onClick={() => go(destination.path, destination.summary)}
            >
              <User size={16} />
              <span>
                <strong>{creator.name.trim()}</strong>
                <small>{t("trackActions.creditsArtist")}</small>
              </span>
            </button>
          );
        })}
        {album && (
          <>
            <p className="track-actions-credits-label">{t("trackActions.creditsAlbum")}</p>
            <button type="button" onClick={() => go(album.path, album.summary)}>
              <Disc3 size={16} />
              <span>
                <strong>{album.label}</strong>
                <small>{t("trackActions.openAlbum")}</small>
              </span>
            </button>
          </>
        )}
        <dl className="track-actions-credits-meta">
          {track.durationMs !== undefined && (
            <div>
              <dt>{t("trackActions.duration")}</dt>
              <dd>{formatTrackDuration(track.durationMs)}</dd>
            </div>
          )}
          <div>
            <dt>{t("trackActions.note")}</dt>
            <dd>{t(track.explicit ? "trackActions.explicit" : "trackActions.notExplicit")}</dd>
          </div>
        </dl>
        {webUrl && (
          <button
            type="button"
            className="track-actions-credits-external"
            onClick={() => void runAction("open-credits", () => openExternalUrl(webUrl), t("trackActions.openedCredits"))}
          >
            <ExternalLink size={16} />
            {t("trackActions.openCredits")}
          </button>
        )}
      </div>
    </div>
  );
}
