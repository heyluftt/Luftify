import { Heart, Maximize2, Settings2, X } from "lucide-react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { usePlayback } from "../playback/usePlayback";
import { useOptionalCapability } from "../spotify/useEngineCapability";

export function MiniPlayerTools({
  settingsOpen,
  onSettings,
  onHide,
}: {
  settingsOpen: boolean;
  onSettings: () => void;
  onHide: () => void;
}) {
  const { playback, command, connected } = usePlayback();
  const like = useOptionalCapability("player.like");
  const saved = Boolean(playback?.isSaved);
  const likeLabel = saved ? t("player.unlike") : t("player.like");
  const settingsLabel = settingsOpen ? t("miniplayer.closeSettings") : t("miniplayer.openSettings");

  return (
    <div className="miniplayer-tools">
      {!settingsOpen && like.show && playback?.currentItem && (
        <button type="button" className={saved ? "miniplayer-like active" : "miniplayer-like"} disabled={!connected || !like.enabled} aria-pressed={saved} aria-label={likeLabel} title={likeLabel} onClick={() => command({ command: "toggleLike" })}>
          <Heart size={13} fill={saved ? "currentColor" : "none"} />
        </button>
      )}
      {!settingsOpen && (
        <button type="button" aria-label={t("miniplayerUi.openMain")} title={t("miniplayerUi.openMain")} onClick={() => void desktopApi.showMainWindow()}>
          <Maximize2 size={12} />
        </button>
      )}
      <button type="button" className={settingsOpen ? "active" : ""} aria-pressed={settingsOpen} aria-label={settingsLabel} title={settingsLabel} onClick={onSettings}>
        <Settings2 size={13} />
      </button>
      <button type="button" className="miniplayer-close" aria-label={t("miniplayer.hide")} title={t("miniplayer.hide")} onClick={onHide}>
        <X size={13} />
      </button>
    </div>
  );
}
