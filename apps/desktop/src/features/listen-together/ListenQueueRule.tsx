import { useMutation } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { desktopApi } from "../../services/desktopApi";
import { t } from "../../i18n";
import type { ListenTogetherStatus, RoomQueuePolicy } from "./listenTogetherTypes";

/** The host decides whether guests may move and remove others' songs. */
export function ListenQueueRule({ status }: { status: ListenTogetherStatus }) {
  const own = status.queuePolicy === "ownSongs";
  const change = useMutation({ mutationFn: (policy: RoomQueuePolicy) => desktopApi.listenTogetherSetQueuePolicy(policy) });
  if (status.role !== "host") {
    return own ? <p className="listen-control-note"><ShieldCheck size={15} aria-hidden="true" />{t("listen.rule.guestOwn")}</p> : null;
  }
  return <div className="listen-control">
    <label className="listen-control-toggle">
      <span>
        <strong>{t("listen.rule.title")}</strong>
        <small>{t(own ? "listen.rule.ownHint" : "listen.rule.openHint")}</small>
      </span>
      <span className="switch">
        <input type="checkbox" checked={own} disabled={change.isPending || status.connection !== "online"}
          onChange={(event) => change.mutate(event.currentTarget.checked ? "ownSongs" : "open")} />
        <span />
      </span>
    </label>
    {change.isError && <small className="listen-control-error" role="alert">{t("listen.control.error")}</small>}
  </div>;
}
