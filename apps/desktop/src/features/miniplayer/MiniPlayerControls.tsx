import { Library, ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { t } from "../../i18n";
import { nextRepeatMode } from "../../stores/playerStore";
import { useAudioControlSettings } from "../audio-control/audioControl";
import { VolumeSlider } from "../audio-control/VolumeSlider";
import { usePlayback } from "../playback/usePlayback";
import type { MiniPlayerPanel } from "./MiniPlayerBrowse";

export function MiniPlayerControls({
  panel,
  onPanel,
}: {
  panel: MiniPlayerPanel | null;
  onPanel: (panel: MiniPlayerPanel) => void;
}) {
  const { playback, command, connected, transportPending, pending } = usePlayback();
  const audioSettings = useAudioControlSettings();
  const transportBusy = !connected;
  const repeatMode = playback?.repeatMode ?? "off";
  const repeatLabel = t(repeatMode === "one" ? "player.repeatOne" : repeatMode === "all" ? "player.repeatAll" : "player.repeatOff");
  const shuffleLabel = t(playback?.shuffleEnabled ? "player.shuffleOn" : "player.shuffleOff");
  const playLabel = playback?.isPlaying ? t("player.pause") : t("player.play");

  return (
    <div className="miniplayer-controls">
      <div className="miniplayer-transport">
        <button type="button" className={playback?.shuffleEnabled ? "miniplayer-mode active" : "miniplayer-mode"} disabled={!connected || pending.shuffle !== null} aria-pressed={Boolean(playback?.shuffleEnabled)} aria-label={shuffleLabel} title={shuffleLabel} onClick={() => command({ command: "setShuffle", enabled: !playback?.shuffleEnabled })}><Shuffle size={13} /></button>
        <button type="button" className="miniplayer-skip" disabled={transportBusy} aria-label={t("player.previous")} title={t("player.previous")} onClick={() => command({ command: "previous" })}><SkipBack size={16} fill="currentColor" /></button>
        <button type="button" className="miniplayer-play-button" disabled={!connected} aria-label={playLabel} title={playLabel} onClick={() => command({ command: playback?.isPlaying ? "pause" : "play" })}>{playback?.isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <button type="button" className="miniplayer-skip" disabled={transportBusy} aria-label={t("player.next")} title={t("player.next")} onClick={() => command({ command: "next" })}><SkipForward size={16} fill="currentColor" /></button>
        <button type="button" className={repeatMode !== "off" ? "miniplayer-mode active" : "miniplayer-mode"} disabled={!connected || pending.repeat !== null} aria-label={repeatLabel} title={repeatLabel} onClick={() => command({ command: "setRepeat", repeatMode: nextRepeatMode(repeatMode) })}>{repeatMode === "one" ? <Repeat1 size={13} /> : <Repeat size={13} />}</button>
      </div>
      <div className="miniplayer-lists">
        <button type="button" className={panel === "queue" ? "active" : ""} aria-expanded={panel === "queue"} aria-label={t("miniplayer.queue")} title={t("miniplayer.queue")} onClick={() => onPanel("queue")}><ListMusic size={14} /></button>
        <button type="button" className={panel === "playlists" ? "active" : ""} aria-expanded={panel === "playlists"} aria-label={t("library.playlists")} title={t("library.playlists")} onClick={() => onPanel("playlists")}><Library size={14} /></button>
      </div>
      <div className="miniplayer-volume">
        <VolumeSlider settings={audioSettings} compact ariaLabel={t("miniplayer.volume")} />
      </div>
    </div>
  );
}
