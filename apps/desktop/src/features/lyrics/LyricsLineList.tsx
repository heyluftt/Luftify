import { t } from "../../i18n";
import {
  type KeyboardEvent,
  type Ref,
} from "react";

import type { LyricsLine } from "../../types/tauri";
import {
  isLyricsInterlude,
  lyricLineClassName,
} from "./lyricsTimeline";

interface LyricsLineListProps {
  lines: LyricsLine[];
  synced: boolean;
  activeIndex: number;
  activeLineRef: Ref<HTMLButtonElement>;
  connected: boolean;
  onActivateLine: (line: LyricsLine) => void;
}

export function LyricsLineList({
  lines,
  synced,
  activeIndex,
  activeLineRef,
  connected,
  onActivateLine,
}: LyricsLineListProps) {
  if (!synced) {
    return (
      <div className="lyrics-lines plain">
        {lines.map((line, index) => (
          <p
            className="lyrics-plain-line"
            key={`${line.text}-${index}`}
          >
            {line.text}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="lyrics-lines synced">
      {lines.map((line, index) => {
        const seekable = connected && line.startMs !== null;
        const keyboardAnchor = activeIndex >= 0 ? activeIndex : 0;
        const className = [
          lyricLineClassName(index, activeIndex),
          isLyricsInterlude(line.text) ? "interlude" : "",
        ].filter(Boolean).join(" ");

        return (
          <button
            ref={index === activeIndex ? activeLineRef : undefined}
            type="button"
            key={`${line.startMs ?? "plain"}-${index}`}
            className={className}
            aria-current={index === activeIndex ? "time" : undefined}
            disabled={!seekable}
            tabIndex={seekable && index === keyboardAnchor ? 0 : -1}
            title={
              !connected
                ? t("lyrics.seekOffline")
                : line.startMs === null
                  ? undefined
                  : t("lyrics.seekLine")
            }
            onClick={() => onActivateLine(line)}
            onKeyDown={moveLyricsLineFocus}
          >
            {line.text}
          </button>
        );
      })}
    </div>
  );
}

function moveLyricsLineFocus(
  event: KeyboardEvent<HTMLButtonElement>,
) {
  const direction =
    event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowUp"
        ? -1
        : 0;
  const container = event.currentTarget.parentElement;

  if (
    !container ||
    (direction === 0 && event.key !== "Home" && event.key !== "End")
  ) {
    return;
  }

  const lines = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  );
  const currentIndex = lines.indexOf(event.currentTarget);
  const targetIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? lines.length - 1
        : Math.min(
            lines.length - 1,
            Math.max(0, currentIndex + direction),
          );

  if (targetIndex === currentIndex || targetIndex < 0) {
    return;
  }

  event.preventDefault();
  lines[targetIndex]?.focus();
}
