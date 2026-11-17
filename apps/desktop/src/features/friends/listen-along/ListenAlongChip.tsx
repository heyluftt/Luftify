import { AudioLines, X } from "lucide-react";
import { t } from "../../../i18n";
import { useFriends, useFriendsControls } from "../useFriends";
import { listenAlongState } from "./listenAlong";

/** In the player bar while listening along: with whom, and a way out. */
export function ListenAlongChip() {
  const along = listenAlongState(useFriends().data);
  const { controls } = useFriendsControls();
  if (!along || along.phase === "ended") return null;
  const text = along.phase === "connecting" ? t("listenAlong.connecting", { name: along.name })
    : along.phase === "paused" ? t("listenAlong.paused", { name: along.name })
    : t("listenAlong.with", { name: along.name });
  return <span className="listen-along-chip" data-phase={along.phase}>
    <AudioLines size={11} aria-hidden="true" />
    <span>{text}</span>
    <button type="button" disabled={controls.pending} onClick={() => controls.send({ type: "stopListenAlong" })}
      title={t("listenAlong.stop")} aria-label={t("listenAlong.stop")}><X size={11} aria-hidden="true" /></button>
  </span>;
}
