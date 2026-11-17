import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import type { LyricsLine } from "../../types/tauri";

/** Where the current line rests, from the top of the column. */
const ANCHOR = 0.42;

/**
 * The lyrics on the left of the music room. Synced lyrics glide so the
 * current line rests a little above the middle and can be clicked to jump
 * there; plain lyrics are a quiet list to scroll.
 */
export function CanvasRoomLyrics({ lines, activeIndex, synced, onSeek }: {
  lines: LyricsLine[];
  activeIndex: number;
  synced: boolean;
  onSeek: (line: LyricsLine) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [offset, setOffset] = useState(0);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!synced) return;
    const line = list.current?.children[Math.max(activeIndex, 0)] as HTMLElement | undefined;
    if (!line || !height) return;
    setOffset(height * ANCHOR - line.offsetTop - line.offsetHeight / 2);
  }, [activeIndex, synced, height, lines]);

  return (
    <div ref={box} className="canvas-room-lyrics" data-synced={synced || undefined} aria-label={t("lyrics.roomLyrics")}>
      <ol ref={list} style={synced ? { transform: `translateY(${offset}px)` } : undefined}>
        {lines.map((line, index) => {
          const state = !synced ? undefined : index === activeIndex ? "active" : index < activeIndex ? "past" : "next";
          const near = synced && Math.abs(index - activeIndex) <= 2;
          const text = line.text.trim() || "♪";
          return (
            <li key={index} data-state={state} data-near={near || undefined}>
              {synced && line.startMs !== null
                ? <button type="button" tabIndex={-1} onClick={() => onSeek(line)}>{text}</button>
                : <span>{text}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
