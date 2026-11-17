import { Trash2 } from "lucide-react";
import { t } from "../../i18n";
import type { ListenTogetherStatus } from "./listenTogetherTypes";
import { SharedTrackAttribution, SharedTrackCover, SharedTrackDetails, trackDuration } from "./SharedTrackDisplay";

export function SharedQueueNowNext({ status, disabled, onRemove }: { status: ListenTogetherStatus; disabled: boolean; onRemove: (id: string) => void }) {
  const current = status.queue?.current;
  const next = status.queue?.items[0];
  return <div className="shared-now-next">
    <section className="shared-playing-card" aria-label={t("listen.queuePlaying")}>
      <div className="shared-song-label"><span className="shared-song-dot" />{t("listen.queuePlaying")}</div>
      {current ? <>
        <div className="shared-song-body"><SharedTrackCover track={current.track} featured />
          <div className="shared-song-copy"><SharedTrackDetails track={current.track} />
            <span className="shared-track-duration">{trackDuration(current.track.durationMs)}</span>
            <SharedTrackAttribution entry={current} participants={status.participants} />
          </div>
        </div>
        <button type="button" className="secondary-button shared-remove-current" disabled={disabled} onClick={() => onRemove(current.id)}>
          <Trash2 size={14} aria-hidden="true" />{t("listen.queueRemoveCurrent")}
        </button>
      </> : <p className="shared-song-empty">{t("listen.noCurrentTrack")}</p>}
    </section>
    <section className="shared-next-card" aria-label={t("listen.queueNext")}>
      <div className="shared-song-label">{t("listen.queueNext")}</div>
      {next ? <div className="shared-song-body"><SharedTrackCover track={next.track} featured />
        <div className="shared-song-copy"><SharedTrackDetails track={next.track} />
          <span className="shared-track-duration">{trackDuration(next.track.durationMs)}</span>
          <SharedTrackAttribution entry={next} participants={status.participants} />
        </div>
      </div> : <p className="shared-song-empty">{t("listen.noNextTrack")}</p>}
    </section>
  </div>;
}
