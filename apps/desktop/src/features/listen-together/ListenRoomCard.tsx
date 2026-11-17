import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Gauge, Headphones, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import type { ListenTogetherStatus, RoomControlMode } from "./listenTogetherTypes";
import { ListenQueueRule } from "./ListenQueueRule";

/** Below this the guest's player counts as in step with the host. */
const IN_SYNC_MS = 300;

export function ListenRoomCard({ status }: { status: ListenTogetherStatus }) {
  const isHost = status.role === "host";
  return <section className="listen-panel listen-room-card" aria-labelledby="listen-room-title">
    <span className="listen-panel-icon" aria-hidden="true"><Headphones size={24} /></span>
    <h2 id="listen-room-title">{t("listen.roomTitle")}</h2>
    <p>{t(isHost ? "listen.inviteHint" : "listen.guestLocked")}</p>
    <RoomCode code={status.joinCode ?? undefined} />
    <RoomControl status={status} />
    <ListenQueueRule status={status} />
    <SyncLine status={status} />
  </section>;
}

function RoomCode({ code }: { code: string | undefined }) {
  const [feedback, setFeedback] = useState<"idle" | "copied" | "error">("idle");
  const [copying, setCopying] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setFeedback("idle");
    setCopying(false);
    return () => { generation.current++; };
  }, [code]);
  useEffect(() => {
    if (feedback !== "copied") return;
    const timer = window.setTimeout(() => setFeedback("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const copy = async () => {
    const current = generation.current;
    setCopying(true);
    try {
      if (!navigator.clipboard || !code) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(code);
      if (generation.current === current) setFeedback("copied");
    } catch {
      if (generation.current === current) setFeedback("error");
    } finally {
      if (generation.current === current) setCopying(false);
    }
  };
  return <>
    <div className="listen-together-code">
      <span>
        <small>{t("listen.code")}</small>
        <strong>{code || "—"}</strong>
      </span>
      <button type="button" className="secondary-button" disabled={copying || !code} onClick={() => void copy()}>
        {feedback === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {t(feedback === "copied" ? "listen.copied" : "listen.copy")}
      </button>
    </div>
    <span className="listen-copy-feedback" role="status">
      {feedback === "error" ? t("listen.copyError") : ""}
    </span>
  </>;
}

/** The host decides whether guests may steer; guests see what they may do. */
function RoomControl({ status }: { status: ListenTogetherStatus }) {
  const everyone = status.control === "everyone";
  const change = useMutation({
    mutationFn: (mode: RoomControlMode) => desktopApi.listenTogetherSetControl(mode),
  });
  if (status.role !== "host") {
    return <p className="listen-control-note" data-allowed={everyone}>
      <SlidersHorizontal size={15} aria-hidden="true" />
      {t(everyone ? "listen.control.guestAllowed" : "listen.control.guestLocked")}
    </p>;
  }
  return <div className="listen-control">
    <label className="listen-control-toggle">
      <span>
        <strong>{t("listen.control.title")}</strong>
        <small>{t(everyone ? "listen.control.everyoneHint" : "listen.control.hostOnlyHint")}</small>
      </span>
      <span className="switch">
        <input
          type="checkbox"
          checked={everyone}
          disabled={change.isPending || status.connection !== "online"}
          onChange={(event) => change.mutate(event.currentTarget.checked ? "everyone" : "hostOnly")}
        />
        <span />
      </span>
    </label>
    {change.isError && <small className="listen-control-error" role="alert">{t("listen.control.error")}</small>}
  </div>;
}

function SyncLine({ status }: { status: ListenTogetherStatus }) {
  if (status.connection !== "online") return null;
  const ping = status.pingMs != null ? t("listen.ping", { n: status.pingMs }) : null;
  const drift = Math.abs(status.driftMs);
  const sync = status.role === "host"
    ? t("listen.sync.hostSource")
    : status.lastSyncMs == null
      ? null
      : drift <= IN_SYNC_MS ? t("listen.sync.inSync") : t("listen.sync.drift", { n: drift });
  const parts = [sync, ping].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="listen-sync-line" data-in-sync={status.role === "host" || drift <= IN_SYNC_MS}>
    <Gauge size={14} aria-hidden="true" />{parts.join(" · ")}
  </p>;
}
