import { AlbumArt } from "../../components/AlbumArt";
import { useTrackContextMenu } from "../../components/track-actions/useTrackContextMenu";
import { t } from "../../i18n";
import type { DiscoveryPick } from "./discoveryRanking";

interface Props extends DiscoveryPick {
  disabled: boolean;
  current: boolean;
  saved: boolean;
  onPlay: () => void;
}

export function DiscoveryTrack({ track, novel, disabled, current, saved, onPlay }: Props) {
  const actions = useTrackContextMenu({ track, canQueue: !disabled, saved });
  return <li>
    <button type="button" disabled={disabled}
      className={current ? "is-current" : undefined}
      aria-current={current ? "true" : undefined}
      title={`${t(novel ? "discovery.newArtist" : "discovery.familiar")} · ${t("discovery.queueHint")}`}
      aria-label={t("discovery.playTrack", { title: track.title })}
      onContextMenu={actions.onContextMenu}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true, cancelable: true, clientX: bounds.left, clientY: bounds.bottom,
          }));
        }
      }}
      onClick={onPlay}>
      <AlbumArt size="small" title={track.title} image={track.coverUri} />
      <span className="discovery-track-copy"><strong>{track.title}</strong><small>{track.creators.map((artist) => artist.name).join(", ")}</small></span>
    </button>
    {actions.menu}
  </li>;
}
