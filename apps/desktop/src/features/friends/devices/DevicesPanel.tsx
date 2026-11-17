import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import { friendsApi } from "../friendsApi";
import type { DeviceLink } from "../friendsTypes";
import { friendsSince, playedAgo } from "../profile/friendsTime";
import { friendsErrorText, useFriends } from "../useFriends";

const DEVICES_KEY = ["friends-devices"] as const;

/** Settings: a link code for the phone and the devices already linked. */
export function DevicesPanel() {
  const friends = useFriends();
  const client = useQueryClient();
  const me = friends.data?.snapshot?.me;
  const online = friends.data?.connection === "online";
  const [link, setLink] = useState<DeviceLink | null>(null);
  const left = useCountdown(link?.expiresAtMs);
  const devices = useQuery({ queryKey: [...DEVICES_KEY, me?.id], queryFn: friendsApi.devices, enabled: Boolean(me) && online, retry: false,
    // While a code waits, the new phone shows up without reloading.
    refetchInterval: link && left > 0 ? 4_000 : false });
  const create = useMutation({ mutationFn: friendsApi.linkCode, onSuccess: setLink });
  const remove = useMutation({ mutationFn: friendsApi.removeDevice, onSuccess: (list) => client.setQueryData([...DEVICES_KEY, me?.id], list) });
  // A new device in the list means the code was used.
  const count = devices.data?.length ?? 0;
  const [seen, setSeen] = useState(count);
  useEffect(() => { if (count > seen && link) setLink(null); setSeen(count); }, [count]);
  useEffect(() => { setLink(null); }, [me?.id]);
  const error = [create, remove].find((mutation) => mutation.isError)?.error;

  if (!me) return null;
  return <div className="recovery-panel devices-panel">
    <h3>{t("devices.title")}</h3>
    <p className="settings-inline-hint">{t("devices.hint")}</p>
    {link && left > 0 ? <div className="devices-link">
      <output className="recovery-code devices-code" aria-label={t("devices.code")}>{link.code}</output>
      <p>{t("devices.steps")}</p>
      <small>{t("devices.expires", { time: formatLeft(left) })}</small>
    </div> : <>
      {link && <p className="recovery-muted">{t("devices.expired")}</p>}
      <div className="recovery-actions">
        <button type="button" className="secondary-button" disabled={!online || create.isPending} onClick={() => create.mutate()}>
          <Smartphone size={15} aria-hidden="true" />{t("devices.link")}
        </button>
      </div>
    </>}
    <div className="devices-list">
      <strong>{t("devices.list")}</strong>
      {devices.data?.length ? <ul>{devices.data.map((device) => <li key={device.id}>
        <Smartphone size={16} aria-hidden="true" />
        <span><b>{device.label}</b><small>{device.lastSeenMs ? t("devices.seen", { ago: playedAgo(device.lastSeenMs) }) : t("devices.added", { date: friendsSince(device.createdAtMs) })}</small></span>
        <button type="button" className="friends-icon-button" disabled={remove.isPending} onClick={() => remove.mutate(device.id)}
          title={t("devices.removeLabel", { name: device.label })} aria-label={t("devices.removeLabel", { name: device.label })}><X size={15} aria-hidden="true" /></button>
      </li>)}</ul> : <p className="recovery-muted">{t("devices.none")}</p>}
    </div>
    {error && <p className="recovery-error" role="alert">{friendsErrorText(error)}</p>}
  </div>;
}

/** Milliseconds until `until`, ticking each second. */
function useCountdown(until: number | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, until - now) : 0;
}

const formatLeft = (ms: number) => {
  const seconds = Math.ceil(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
