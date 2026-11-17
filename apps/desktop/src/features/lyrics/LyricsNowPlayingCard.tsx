import type { MediaItem } from "@luft/protocol-types";
import { useRef, type MouseEventHandler } from "react";

import { AlbumArt } from "../../components/AlbumArt";
import { ArtistLinks } from "../../components/entity/ArtistLinks";
import { t } from "../../i18n";
import type {
  LyricsDocument,
  LyricsVisualSettings,
} from "../../types/tauri";
import { LyricsArtworkAmbient } from "./LyricsArtworkAmbient";
import { SongVideo, useSongVideoUrl } from "./SongVideo";
import { useTitleFit } from "./useTitleFit";

interface LyricsNowPlayingCardProps {
  item: MediaItem | undefined;
  lyrics: LyricsDocument | undefined;
  onContextMenu: MouseEventHandler<HTMLElement>;
  playing: boolean;
  songVideosEnabled: boolean;
  visualSettings: LyricsVisualSettings;
}

export function LyricsNowPlayingCard({
  item,
  lyrics,
  onContextMenu,
  playing,
  songVideosEnabled,
  visualSettings,
}: LyricsNowPlayingCardProps) {
  // The card is tall and narrow: exactly the Canvas' portrait format.
  const video = useSongVideoUrl(item, songVideosEnabled);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const title = item?.title ?? t("lyrics.noTrack");
  useTitleFit(titleRef, title);
  return (
    <aside className={`lyrics-now${item ? "" : " is-empty"}`} onContextMenu={onContextMenu}>
      <div className="lyrics-now-body">
        <div className={`lyrics-artwork${video.url ? " has-song-video" : ""}`}>
          <LyricsArtworkAmbient
            image={item?.coverUri}
            playing={playing}
            settings={visualSettings}
            title={title}
          />
          <AlbumArt
            title={title}
            size="feature"
            image={item?.coverUri}
          />
          {video.url && (
            <SongVideo
              url={video.url}
              playing={playing}
              onUnavailable={video.markUnavailable}
            />
          )}
        </div>

        <div className="lyrics-track-copy">
          <h1 ref={titleRef} title={title}>{title}</h1>
          <p className="lyrics-track-artists">
            <ArtistLinks
              creators={item?.creators}
              fallback={t("lyrics.startSong")}
            />
          </p>
          {item?.albumName && item.albumName.trim() !== item.title.trim() && (
            <p className="lyrics-track-album" title={item.albumName}>
              {item.albumName}
            </p>
          )}
          {lyrics && (
            <div className="lyrics-provider">
              <span className={lyrics.synced ? "is-synced" : "is-plain"}>
                {t(lyrics.synced ? "lyrics.synced" : "lyrics.plain")}
              </span>
              {lyrics.provider ? <small>{lyrics.provider}</small> : null}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
