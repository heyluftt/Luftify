import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { t } from "../../i18n";
import { usePlayerStore } from "../../stores/playerStore";
import { pushNotice } from "../notices/noticeStore";
import { remoteStateChanged, remoteStateOf } from "./remoteState";
import { otherDevices, useRemoteDevices } from "./remoteStore";
import type { RemoteCommand, RemoteDevice, RemoteState } from "./remoteTypes";
import { runRemoteCommand } from "./runRemoteCommand";

/** Without a change, still now and then, so a phone's progress bar stays right. */
const HEARTBEAT_MS = 15_000;

/**
 * This PC as a player for the phone: runs its commands and tells it what
 * plays. Silent while no other device of the profile is online.
 */
export function RemoteSync() {
  const steered = useRef(new Set<string>());
  useEffect(() => {
    let disposed = false;
    const unlisten: (() => void)[] = [];
    const keep = (fn: () => void) => { if (disposed) fn(); else unlisten.push(fn); };
    void listen<{ you: string; devices: RemoteDevice[] }>("friends://remote-devices", (event) => {
      useRemoteDevices.getState().set(event.payload.you, event.payload.devices);
      // A phone that just came: it needs the state now, not with the next change.
      if (otherDevices(event.payload).length) publish(true);
    }).then(keep).catch(() => undefined);
    void listen<{ fromLabel: string; command: RemoteCommand }>("friends://remote-command", (event) => {
      const { fromLabel, command } = event.payload;
      if (!steered.current.has(fromLabel)) {
        steered.current.add(fromLabel);
        pushNotice({ id: `remote-${fromLabel}`, kind: "remote", title: t("remote.steering", { name: fromLabel }) });
      }
      runRemoteCommand(command);
    }).then(keep).catch(() => undefined);
    return () => { disposed = true; unlisten.forEach((fn) => fn()); };
  }, []);

  useEffect(() => {
    const unsubscribe = usePlayerStore.subscribe(() => publish(false));
    const timer = window.setInterval(() => publish(true), HEARTBEAT_MS);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, []);
  return null;
}

let last: { state: RemoteState; at: number } | null = null;

function publish(force: boolean) {
  if (!otherDevices(useRemoteDevices.getState()).length) {
    last = null;
    return;
  }
  const state = remoteStateOf(usePlayerStore.getState().playback);
  const now = Date.now();
  if (!force && !remoteStateChanged(last?.state ?? null, state, last ? now - last.at : 0)) return;
  last = { state, at: now };
  void invoke("friends_remote_state", { state }).catch(() => undefined);
}
