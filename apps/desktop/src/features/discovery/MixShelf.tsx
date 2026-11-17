import { useCallback, useState } from "react";
import { t } from "../../i18n";
import { MixCard } from "./MixCard";
import { MixContextMenu, type MixMenuItem } from "./MixContextMenu";
import { PIN_LIMIT, useMixLibrary, type SavedMix } from "./mixLibrary";
import { isFreshMix, mixTitle } from "./mixPresentation";
import "../../styles/components/mix-shelf.css";

export function MixShelf({ selected, onSelect, playback, generating, replacingId, previewReplace, canPlay, onRemove }: {
  selected: string | undefined;
  onSelect: (id: string) => void;
  playback: { mixId?: string; playing: boolean; play: (mix: SavedMix) => void; pause: () => void };
  generating: boolean;
  /** The mix a new one pushes out: flagged on preview, swapped for the placeholder while generating. */
  replacingId: string | undefined;
  previewReplace: boolean;
  canPlay: boolean;
  onRemove: (mix: SavedMix) => void;
}) {
  const { mixes, togglePin, rename, ready } = useMixLibrary();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const [editing, setEditing] = useState<string>();
  const close = useCallback(() => setMenu(undefined), []);
  const pinFull = mixes.filter((mix) => mix.pinned).length >= PIN_LIMIT;
  const menuMix = menu && mixes.find((mix) => mix.id === menu.id);
  const menuItems = (mix: SavedMix): MixMenuItem[] => [
    { label: t("discovery.rename"), onSelect: () => setEditing(mix.id) },
    {
      label: t(mix.pinned ? "discovery.unpin" : "discovery.pin"),
      disabled: !mix.pinned && pinFull,
      onSelect: () => togglePin(mix.id),
    },
    { label: t("discovery.removeMix"), danger: true, onSelect: () => onRemove(mix) },
  ];
  if (!mixes.length && !generating) return null;
  return <div className="mix-shelf" aria-busy={generating}>
    {generating && <div className="mix-card mix-card-skeleton" aria-hidden="true">
      <span className="mix-card-cover"><span className="mix-cover-grid" /></span>
      <span className="mix-card-copy"><small /><strong /><span /></span>
    </div>}
    {mixes.filter((mix) => !(generating && mix.id === replacingId)).map((mix, index) => {
      const title = mixTitle(mix);
      return <MixCard key={mix.id} mix={mix} title={title}
        state={{
          latest: index === 0 && !generating && isFreshMix(mix),
          selected: selected === mix.id,
          editing: ready && editing === mix.id,
          current: playback.mixId === mix.id,
          playing: playback.playing,
          replacing: previewReplace && !generating && replacingId === mix.id,
          canPlay,
          canEdit: ready,
          pinFull,
        }}
        onSelect={() => onSelect(mix.id)}
        onFinishRename={(name) => { if (name) rename(mix.id, name); setEditing(undefined); }}
        onPlay={() => playback.play(mix)}
        onPause={playback.pause}
        onTogglePin={() => togglePin(mix.id)}
        onMenu={(x, y) => setMenu({ id: mix.id, x, y })} />;
    })}
    {menu && menuMix && <MixContextMenu key={`${menu.id}:${menu.x}:${menu.y}`} x={menu.x} y={menu.y}
      items={menuItems(menuMix)} onClose={close} />}
  </div>;
}
