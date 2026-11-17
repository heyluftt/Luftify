import { MoreHorizontal, Pause, Pin, Play } from "lucide-react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { MixCardHeader } from "./MixCardHeader";
import type { SavedMix } from "./mixLibrary";

export interface MixCardState {
  latest: boolean;
  selected: boolean;
  editing: boolean;
  /** This mix is the active playback context. */
  current: boolean;
  playing: boolean;
  /** "Neuer Mix" would push this one out. */
  replacing: boolean;
  canPlay: boolean;
  canEdit: boolean;
  pinFull: boolean;
}

export function MixCard({ mix, title, state, onSelect, onFinishRename, onPlay, onPause, onTogglePin, onMenu }: {
  mix: SavedMix; title: string; state: MixCardState;
  onSelect: () => void; onFinishRename: (name?: string) => void;
  onPlay: () => void; onPause: () => void; onTogglePin: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const pause = state.current && state.playing;
  const pinLocked = !mix.pinned && state.pinFull;
  return <article className="mix-card"
    data-selected={state.selected || undefined} data-current={state.current || undefined}
    data-pinned={mix.pinned || undefined} data-replacing={state.replacing || undefined}
    onContextMenu={(event) => {
      if (!state.canEdit) return;
      event.preventDefault(); event.stopPropagation();
      onMenu(event.clientX, event.clientY);
    }}
    onKeyDown={(event) => {
      if (!state.canEdit || event.target instanceof HTMLInputElement) return;
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        onMenu(bounds.left + 16, bounds.top + 16);
      }
    }}>
    <div className="mix-card-cover">
      <span className="mix-cover-grid" aria-hidden="true">{mix.picks.slice(0, 4).map(({ track }) =>
        <AlbumArt key={track.uri} size="small" title={track.title} image={track.coverUri} />)}</span>
      <button type="button" className="mix-card-play" disabled={!state.canPlay}
        aria-label={t(pause ? "discovery.pauseMix" : "discovery.playMix", { title })}
        title={pause ? t("discovery.pause") : t("discovery.queueHint")}
        onClick={pause ? onPause : onPlay}>
        {pause ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>
    </div>
    <MixCardHeader mix={mix} title={title} latest={state.latest} selected={state.selected}
      editing={state.editing} onSelect={onSelect} onFinish={onFinishRename} />
    <div className="mix-card-tools">
      <button type="button" className="mix-card-icon mix-card-pin" aria-pressed={mix.pinned}
        disabled={!state.canEdit || pinLocked}
        aria-label={t(mix.pinned ? "discovery.unpin" : "discovery.pin")}
        title={t(mix.pinned ? "discovery.pinnedHint" : pinLocked ? "discovery.pinFull" : "discovery.pinHint")}
        onClick={onTogglePin}><Pin size={15} fill={mix.pinned ? "currentColor" : "none"} /></button>
      <button type="button" className="mix-card-icon" aria-haspopup="menu" disabled={!state.canEdit}
        aria-label={t("discovery.moreActions", { title })} title={t("discovery.moreActionsShort")}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          onMenu(bounds.right - 208, bounds.bottom + 6);
        }}><MoreHorizontal size={16} /></button>
    </div>
    {state.replacing && <span className="mix-card-flag">{t("discovery.willReplace")}</span>}
  </article>;
}
