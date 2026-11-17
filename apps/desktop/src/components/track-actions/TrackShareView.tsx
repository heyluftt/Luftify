import type { MediaItem } from "@luft/protocol-types";
import { Copy, ExternalLink, Link2 } from "lucide-react";
import { copyText, openExternalUrl, shareCopy } from "../../features/entities/spotifyLinks";
import { t, type MessageKey } from "../../i18n";
import type { RunTrackAction } from "./trackActionTypes";

export function TrackShareView({ track, webUrl, pendingAction, runAction, onBack }: {
  track: MediaItem;
  webUrl: string | undefined;
  pendingAction: string | undefined;
  runAction: RunTrackAction;
  onBack: () => void;
}) {
  const action = (key: string, label: MessageKey, done: MessageKey, run: () => void | Promise<void>, icon: React.ReactNode) => (
    <button type="button" disabled={pendingAction === key} onClick={() => void runAction(key, run, t(done))}>
      {icon}
      {t(label)}
    </button>
  );

  return (
    <div className="track-actions-submenu">
      <button type="button" className="track-actions-back" onClick={onBack}>{t("trackActions.back")}</button>
      <div className="track-actions-menu-list">
        {webUrl && action("copy-link", "trackActions.copyLink", "trackActions.copiedLink", () => copyText(webUrl), <Link2 size={16} />)}
        {action("copy-uri", "trackActions.copyUri", "trackActions.copiedUri", () => copyText(track.uri), <Copy size={16} />)}
        {action("copy-title", "trackActions.copyTitle", "trackActions.copiedTitle", () => copyText(shareCopy(track)), <Copy size={16} />)}
        {webUrl && action("open-web", "trackActions.openWeb", "trackActions.openedWeb", () => openExternalUrl(webUrl), <ExternalLink size={16} />)}
      </div>
    </div>
  );
}
