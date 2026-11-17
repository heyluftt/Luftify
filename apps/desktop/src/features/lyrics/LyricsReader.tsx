import type { MediaItem } from "@luft/protocol-types";
import type { UseQueryResult } from "@tanstack/react-query";
import { AlertCircle, LoaderCircle, LocateFixed, MicVocal, Music2 } from "lucide-react";
import type { Ref } from "react";

import { t } from "../../i18n";
import type { LyricsDocument, LyricsLine, Settings } from "../../types/tauri";
import { LyricsLineList } from "./LyricsLineList";
import { LyricsError, LyricsState } from "./LyricsReaderStates";

interface LyricsReaderProps {
  item: MediaItem | undefined;
  settings: UseQueryResult<Settings>;
  lyrics: UseQueryResult<LyricsDocument>;
  metadataReady: boolean;
  activeIndex: number;
  activeLineRef: Ref<HTMLButtonElement>;
  readerRef: Ref<HTMLDivElement>;
  connected: boolean;
  followingPaused: boolean;
  onActivateLine: (line: LyricsLine) => void;
  onResumeFollowing: () => void;
}

/**
 * The lyrics panel. The panel keeps the theme's surface; the scroll area
 * inside it fades lines out at both edges instead of cutting them off.
 */
export function LyricsReader({
  item,
  settings,
  lyrics,
  metadataReady,
  activeIndex,
  activeLineRef,
  readerRef,
  connected,
  followingPaused,
  onActivateLine,
  onResumeFollowing,
}: LyricsReaderProps) {
  const document = lyrics.data;
  return (
    <>
      <section className="lyrics-reader" aria-label={t("lyrics.reader")}>
        <div ref={readerRef} className="lyrics-scroll" tabIndex={0}>
          {!item ? (
            <LyricsState icon={<Music2 />} title={t("lyrics.noTrack")} copy={t("lyrics.startSong")} />
          ) : settings.isPending ? (
            <LyricsState icon={<LoaderCircle />} title={t("lyrics.moment")} spinning />
          ) : settings.isError ? (
            <LyricsState
              icon={<AlertCircle />}
              title={t("lyrics.settingsError")}
              action={{ label: t("lyrics.retry"), onClick: () => void settings.refetch() }}
            />
          ) : settings.data?.lyricsEnabled === false ? (
            <LyricsState icon={<MicVocal />} title={t("lyrics.disabled")} />
          ) : !metadataReady ? (
            <LyricsState icon={<LoaderCircle />} title={t("lyrics.trackLoading")} spinning />
          ) : lyrics.isPending ? (
            <LyricsState icon={<LoaderCircle />} title={t("lyrics.loading")} spinning />
          ) : lyrics.isError ? (
            <LyricsError error={lyrics.error} retry={() => void lyrics.refetch()} />
          ) : document?.instrumental ? (
            <LyricsState icon={<Music2 />} title={t("lyrics.instrumental")} copy={t("lyrics.instrumentalHint")} />
          ) : document && document.lines.length > 0 ? (
            <LyricsLineList
              lines={document.lines}
              synced={document.synced}
              activeIndex={activeIndex}
              activeLineRef={activeLineRef}
              connected={connected}
              onActivateLine={onActivateLine}
            />
          ) : (
            <LyricsState icon={<AlertCircle />} title={t("lyrics.notFound")} />
          )}
        </div>
      </section>
      {document?.synced === true && followingPaused ? (
        <button
          type="button"
          className="lyrics-follow-button"
          onClick={onResumeFollowing}
          title={t("lyrics.followHint")}
        >
          <LocateFixed size={15} aria-hidden="true" />
          {t("lyrics.follow")}
        </button>
      ) : null}
    </>
  );
}
