import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { chatApi, inboxKey, type ChatAccount } from "./chatApi";

export function useChatVisible() {
  const current = () => document.visibilityState === "visible" && document.hasFocus();
  const [visible, setVisible] = useState(current);
  useEffect(() => {
    const update = () => setVisible(current());
    window.addEventListener("focus", update); window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => { window.removeEventListener("focus", update); window.removeEventListener("blur", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  return visible;
}

/** A background window or a reader browsing old messages does not acknowledge new arrivals. */
export function useChatRead(account: ChatAccount, peer: string, through: number, enabled: boolean) {
  const client = useQueryClient();
  const acknowledged = useRef(0);
  useEffect(() => {
    if (!enabled || !through) return;
    let stopped = false;
    let pending = false;
    const read = async () => {
      if (pending || stopped || acknowledged.current >= through) return;
      pending = true;
      try {
        const result = await chatApi.read(account, peer, through);
        if (!stopped) { acknowledged.current = Math.max(acknowledged.current, result.through); void client.invalidateQueries({ queryKey: inboxKey(account) }); }
      } catch { /* Keep it unread and retry while this conversation is actually visible. */ }
      finally { pending = false; }
    };
    void read();
    const timer = setInterval(() => void read(), 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [account.serverUrl, account.profileId, peer, through, enabled, client]);
}
