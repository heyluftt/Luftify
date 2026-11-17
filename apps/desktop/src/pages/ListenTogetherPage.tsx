import { Headphones, Radio, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { FriendsRoomInvite } from "../features/friends/FriendsRoomInvite";
import { useListenTogether } from "../features/listen-together/useListenTogether";
import { ListenRoomCard } from "../features/listen-together/ListenRoomCard";
import { ListenPeoplePanel } from "../features/listen-together/ListenPeoplePanel";
import { listenErrorText } from "../features/listen-together/listenTexts";
import { SharedQueuePanel } from "../features/listen-together/SharedQueuePanel";
import { SERVER_AVAILABLE, ServerNotice } from "../features/server/ServerNotice";

import { t } from "../i18n";

export function ListenTogetherPage() {
  const { query, createRoom, joinRoom, leave } = useListenTogether();
  const [code, setCode] = useState("");
  const status = query.data;
  const inRoom = Boolean(status?.roomId);
  const connecting = status?.connection === "connecting" || status?.connection === "reconnecting";
  const busy = createRoom.isPending || joinRoom.isPending || leave.isPending || connecting;
  const disabled = busy || !query.data || query.isError;
  const actionError = [createRoom, joinRoom, leave].find((action) => action.isError)?.error;
  const error = listenErrorText(status?.error)
    ?? (actionError ? listenErrorText(errorMessage(actionError)) ?? t("listen.actionError") : undefined)
    ?? (query.isError ? t("listen.statusError") : undefined);
  const resetErrors = () => { createRoom.reset(); joinRoom.reset(); leave.reset(); };
  const label = status?.connection === "reconnecting"
    ? (status.reconnectAttempts > 1 ? t("listen.reconnectingAttempt", { n: status.reconnectAttempts }) : t("listen.reconnecting"))
    : connecting ? t("listen.connecting")
    : inRoom && !status?.hostConnected ? t("listen.waitingHost")
    : inRoom ? t("listen.online") : t("listen.idle");

  return <div className="page listen-together-page">
    <header className="listen-heading">
      <span className="listen-heading-icon" aria-hidden="true"><Headphones size={26} /></span>
      <div><h1>{t("listen.title")}</h1><p>{t("listen.subtitle")}</p></div>
      <Link className="secondary-button" to="/friends"><Users size={16} aria-hidden="true" />{t("nav.friends")}</Link>
      <span className="listen-status" data-state={inRoom && status?.connection === "online" && status.hostConnected ? "online" : connecting ? "busy" : "idle"}
        role="status"><span aria-hidden="true" />{label}</span>
    </header>
    <ServerNotice />
    {error && SERVER_AVAILABLE && <p className="listen-feedback" role="alert">{error}</p>}

    {!inRoom ? <>
      <div className="listen-lobby">
        <section className="listen-panel listen-host-panel" aria-labelledby="listen-host-title">
          <span className="listen-panel-icon" aria-hidden="true"><Radio size={24} /></span>
          <h2 id="listen-host-title">{t("listen.hostTitle")}</h2>
          <p>{t("listen.hostHint")}</p>
          <button type="button" className="primary-button" disabled={disabled}
            onClick={() => { resetErrors(); createRoom.mutate(); }}>
            <Headphones size={17} aria-hidden="true" />{t(createRoom.isPending ? "listen.creating" : "listen.create")}
          </button>
        </section>
        <form className="listen-panel listen-join-panel" aria-labelledby="listen-join-title"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || code.trim().length < 6) return;
            resetErrors(); joinRoom.mutate(code.trim());
          }}>
          <span className="listen-panel-icon" aria-hidden="true"><Users size={24} /></span>
          <h2 id="listen-join-title">{t("listen.joinTitle")}</h2>
          <p>{t("listen.joinHint")}</p>
          <label htmlFor="listen-join-code">{t("listen.code")}</label>
          <div className="listen-join-controls">
            <input id="listen-join-code" value={code} maxLength={8} autoComplete="off" spellCheck={false}
              placeholder="ABCDEF" disabled={disabled} autoCapitalize="characters"
              onChange={(event) => setCode(event.currentTarget.value.replace(/[\s-]/g, "").toUpperCase())} />
            <button type="submit" className="secondary-button" disabled={disabled || code.trim().length < 6}>
              {t(joinRoom.isPending ? "listen.joining" : "listen.join")}
            </button>
          </div>
        </form>
      </div>
      <FriendsRoomInvite />
    </> : <div className="listen-room-layout">
      <div className="listen-room-side">
        <ListenRoomCard status={status!} />
        <ListenPeoplePanel status={status!} leaving={leave.isPending} onLeave={() => { resetErrors(); leave.mutate(); }} />
        <FriendsRoomInvite />
      </div>
      <SharedQueuePanel key={status!.roomId} status={status!} />
    </div>}
  </div>;
}

function errorMessage(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return undefined;
}
