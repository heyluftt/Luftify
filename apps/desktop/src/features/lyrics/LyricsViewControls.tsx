import { t } from "../../i18n";
import {
  Disc3,
  Eye,
  EyeOff,
  Film,
  Image,
  Maximize2,
  MicVocal,
  Minimize2,
  Orbit,
  Captions,
  CaptionsOff,
} from "lucide-react";
import type { LyricsViewMode } from "./useLyricsViewMode";

export type { LyricsViewMode } from "./useLyricsViewMode";

export interface LyricsViewControlsProps {
  /** The current title has a Canvas the view could play. */
  canvasAvailable: boolean;
  canvasHidden: boolean;
  detailsHidden: boolean;
  fullscreen: boolean;
  lyricsAvailable: boolean;
  mode: LyricsViewMode;
  onModeChange: (mode: LyricsViewMode) => void;
  onToggleCanvas: () => void;
  onToggleDetails: () => void;
  onToggleFullscreen: () => void;
  /** The music room's lyrics toggle; only when the song has lyrics. */
  roomLyrics?: { hidden: boolean; onToggle: () => void } | undefined;
}

export function LyricsViewControls({
  canvasAvailable,
  canvasHidden,
  detailsHidden,
  fullscreen,
  lyricsAvailable,
  mode,
  onModeChange,
  onToggleCanvas,
  onToggleDetails,
  onToggleFullscreen,
  roomLyrics,
}: LyricsViewControlsProps) {
  return (
    <div className="lyrics-view-controls">
      <div
        className="lyrics-view-switch"
        role="group"
        aria-label={t("lyrics.view")}
      >
        <button
          type="button"
          className={`lyrics-view-option${mode === "lyrics" ? " is-active" : ""}`}
          onClick={() => onModeChange("lyrics")}
          disabled={!lyricsAvailable && mode !== "lyrics"}
          aria-pressed={mode === "lyrics"}
          title={
            lyricsAvailable || mode === "lyrics"
              ? t("lyrics.showLyrics")
              : t("lyrics.noLyricsForTrack")
          }
        >
          <MicVocal
            className="lyrics-view-option-icon"
            size={16}
            aria-hidden="true"
          />
          <span className="lyrics-view-option-label">{t("lyrics.tabLyrics")}</span>
        </button>

        <button
          type="button"
          className={`lyrics-view-option${mode === "cover" ? " is-active" : ""}`}
          onClick={() => onModeChange("cover")}
          aria-pressed={mode === "cover"}
          title={t("lyrics.showCover")}
        >
          <Disc3
            className="lyrics-view-option-icon"
            size={16}
            aria-hidden="true"
          />
          <span className="lyrics-view-option-label">{t("lyrics.tabCover")}</span>
        </button>
        <button
          type="button"
          className={`lyrics-view-option${mode === "room" ? " is-active" : ""}`}
          onClick={() => onModeChange("room")}
          aria-pressed={mode === "room"}
          title={t("lyrics.showRoom")}
        >
          <Orbit className="lyrics-view-option-icon" size={16} aria-hidden="true" />
          <span className="lyrics-view-option-label">{t("lyrics.tabRoom")}</span>
        </button>
      </div>

      {canvasAvailable && (mode !== "lyrics" || !detailsHidden) && (
        <button
          type="button"
          className="lyrics-details-toggle"
          onClick={onToggleCanvas}
          aria-pressed={canvasHidden}
          aria-label={t(canvasHidden ? "lyrics.canvasShow" : "lyrics.canvasHide")}
          title={t(canvasHidden ? "lyrics.canvasShow" : "lyrics.canvasHide")}
        >
          {canvasHidden
            ? <Film size={15} aria-hidden="true" />
            : <Image size={15} aria-hidden="true" />}
        </button>
      )}

      {mode === "lyrics" && (
        <button
          type="button"
          className="lyrics-details-toggle"
          onClick={onToggleDetails}
          aria-pressed={detailsHidden}
          aria-label={t(detailsHidden ? "lyrics.coverShow" : "lyrics.coverHide")}
          title={t(detailsHidden ? "lyrics.coverShow" : "lyrics.coverHide")}
        >
          {detailsHidden
            ? <Eye size={15} aria-hidden="true" />
            : <EyeOff size={15} aria-hidden="true" />}
        </button>
      )}

      {mode === "room" && roomLyrics && (
        <button
          type="button"
          className="lyrics-details-toggle"
          onClick={roomLyrics.onToggle}
          aria-pressed={!roomLyrics.hidden}
          aria-label={t(roomLyrics.hidden ? "lyrics.roomLyricsShow" : "lyrics.roomLyricsHide")}
          title={t(roomLyrics.hidden ? "lyrics.roomLyricsShow" : "lyrics.roomLyricsHide")}
        >
          {roomLyrics.hidden
            ? <Captions size={15} aria-hidden="true" />
            : <CaptionsOff size={15} aria-hidden="true" />}
        </button>
      )}

      <button
        type="button"
        className="lyrics-fullscreen-toggle"
        onClick={onToggleFullscreen}
        aria-pressed={fullscreen}
        aria-label={t(fullscreen ? "lyrics.fullscreenClose" : "lyrics.fullscreenOpen")}
        title={t(fullscreen ? "lyrics.fullscreenClose" : "lyrics.fullscreenOpen")}
      >
        {fullscreen ? (
          <Minimize2 size={17} aria-hidden="true" />
        ) : (
          <Maximize2 size={17} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
