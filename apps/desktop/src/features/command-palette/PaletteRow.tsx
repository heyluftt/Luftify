import {
  Activity, AudioLines, Blocks, ChartColumn, Disc3, FastForward, Gift, Heart, HeartOff, House, Library, Link,
  ListMusic, MicVocal, Music2, Palette, Pause, PictureInPicture2, Play, Quote, Radio, Repeat, Repeat1,
  Search, Settings, Shuffle, SkipBack, SkipForward, SlidersVertical, Users, Volume2, VolumeX,
  type LucideIcon,
} from "lucide-react";
import type { MouseEvent } from "react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import type { PaletteIconName, PaletteItem } from "./paletteTypes";
import { isMedia, mediaCanQueue } from "./paletteTypes";

const ICONS: Record<PaletteIconName, LucideIcon> = {
  search: Search, play: Play, pause: Pause, next: SkipForward, previous: SkipBack, heart: Heart,
  "heart-off": HeartOff, shuffle: Shuffle, repeat: Repeat, "repeat-one": Repeat1, queue: ListMusic,
  album: Disc3, artist: MicVocal, playlist: ListMusic, home: House, library: Library, lyrics: Quote,
  insights: ChartColumn, recaps: Gift, listen: Users, settings: Settings, modules: Blocks, diagnostics: Activity,
  theme: Palette, volume: Volume2, mute: VolumeX, seek: FastForward, equalizer: SlidersVertical,
  room: AudioLines, miniplayer: PictureInPicture2, link: Link, track: Music2, liked: Heart, context: Radio,
};

export function PaletteRow({ item, active, onHover, onRun }: {
  item: PaletteItem;
  active: boolean;
  onHover: () => void;
  onRun: (event: MouseEvent) => void;
}) {
  const Icon = ICONS[item.icon];
  const media = isMedia(item);
  const round = item.icon === "artist" && media;
  return (
    <button
      type="button"
      role="option"
      id={`palette-option-${item.id}`}
      aria-selected={active}
      disabled={item.disabled}
      className={[
        "command-palette-row",
        active ? "is-active" : "",
        item.active ? "is-on" : "",
        media ? "is-media" : "",
      ].filter(Boolean).join(" ")}
      onMouseMove={onHover}
      onClick={onRun}
    >
      <span className={`command-palette-row-icon${round ? " is-round" : ""}${item.icon === "liked" ? " is-liked" : ""}`} aria-hidden="true">
        {media && item.icon !== "liked"
          ? <AlbumArt title={item.label} size="tiny" image={item.cover} />
          : <Icon size={15} fill={item.icon === "liked" ? "currentColor" : "none"} />}
      </span>
      <span className="command-palette-row-copy">
        <strong>{item.label}</strong>
        {item.subtitle && <small>{item.subtitle}</small>}
      </span>
      <RowHint item={item} active={active} />
    </button>
  );
}

function RowHint({ item, active }: { item: PaletteItem; active: boolean }) {
  if (active && !item.disabled) {
    const primary = isMedia(item)
      ? item.action.media.kind === "entity" && item.action.media.category === "artists"
        ? t("command.action.open")
        : t("command.action.play")
      : t("command.action.run");
    return (
      <span className="command-palette-row-hint">
        {mediaCanQueue(item) && <span className="command-palette-row-secondary"><kbd>Ctrl</kbd><kbd>↵</kbd> {t("command.action.queue")}</span>}
        <span><kbd>↵</kbd> {primary}</span>
      </span>
    );
  }
  if (item.hint) return <kbd className="command-palette-row-key">{item.hint}</kbd>;
  if (item.active) return <span className="command-palette-row-dot" aria-hidden="true" />;
  return null;
}
