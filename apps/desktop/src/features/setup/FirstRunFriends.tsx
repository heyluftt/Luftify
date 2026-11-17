import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, LoaderCircle, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { normalizeFriendCode } from "../friends/friendCode";
import { friendsApi } from "../friends/friendsApi";
import { FRIENDS_QUERY_KEY, friendsErrorText, useFriends } from "../friends/useFriends";
import { RestoreForm } from "../friends/recovery/RestoreForm";

/**
 * Second first-run step: the friends profile and, if someone gave you their
 * code, the friend request. Skipped when a profile exists or the server is
 * out of reach; everything here can also be done later on the friends page.
 */
export function FirstRunFriends({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const friends = useFriends();
  const settings = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [created, setCreated] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const saved = settings.data?.listenTogether;
  const savedName = saved?.displayName ?? "";
  useEffect(() => { if (savedName) setName((current) => current || savedName); }, [savedName]);
  const needed = friends.data?.connection === "inactive";
  useEffect(() => { if (friends.data && !needed && !created) onDone(); }, [friends.data, needed, created, onDone]);
  useEffect(() => { if (friends.isError) onDone(); }, [friends.isError, onDone]);

  const finish = useMutation({
    mutationFn: async () => {
      if (!created) {
        const status = await friendsApi.run({ type: "activate", profile: { displayName: name.trim(), avatarUri: saved?.avatarUri ?? null } });
        // Before the cache update, so the step does not close as "already set up".
        setCreated(true);
        client.setQueryData(FRIENDS_QUERY_KEY, status);
      }
      const friendCode = normalizeFriendCode(code);
      if (friendCode) client.setQueryData(FRIENDS_QUERY_KEY, await friendsApi.run({ type: "action", action: { type: "request", friendCode } }));
    },
    onSuccess: onDone,
  });
  // An existing profile from another PC, brought back with its recovery code.
  const restore = useMutation({
    mutationFn: async (recovery: string) => {
      const status = await friendsApi.run({ type: "restore", code: recovery });
      setCreated(true);
      client.setQueryData(FRIENDS_QUERY_KEY, status);
      void client.invalidateQueries({ queryKey: ["settings"] });
    },
    onSuccess: onDone,
  });

  if (!needed && !created) {
    return <div className="first-run-detecting" role="status"><LoaderCircle className="is-spinning" /></div>;
  }
  if (restoring) {
    return <div className="first-run-friends">
      <header className="first-run-heading">
        <span className="first-run-mark"><KeyRound size={16} /></span>
        <h1 id="first-run-title">{t("recovery.restore")}</h1>
      </header>
      <RestoreForm pending={restore.isPending} onCancel={() => { setRestoring(false); restore.reset(); }} onRestore={(recovery) => restore.mutate(recovery)} />
      {restore.isError && <p className="first-run-error" role="alert">{friendsErrorText(restore.error)}</p>}
    </div>;
  }
  return <form className="first-run-friends" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !finish.isPending) finish.mutate(); }}>
    <header className="first-run-heading">
      <span className="first-run-mark"><Users size={16} /></span>
      <h1 id="first-run-title">{t("firstRun.friendsTitle")}</h1>
      <p id="first-run-description">{t("firstRun.friendsDescription")}</p>
    </header>
    <label htmlFor="first-run-name">{t("listen.profileName")}</label>
    <input id="first-run-name" value={name} maxLength={32} autoComplete="nickname" required autoFocus
      disabled={finish.isPending || created} onChange={(event) => setName(event.currentTarget.value)} />
    <label htmlFor="first-run-code">{t("firstRun.friendCode")}</label>
    <input id="first-run-code" className="friends-mono" value={code} maxLength={24} autoComplete="off" spellCheck={false}
      placeholder="LF-…" disabled={finish.isPending} onChange={(event) => setCode(event.currentTarget.value.toUpperCase())} />
    {finish.isError && <p className="first-run-error" role="alert">
      {errorCode(finish.error) === "friends.error.notFound" ? t("firstRun.codeNotFound") : friendsErrorText(finish.error)}
    </p>}
    <button type="button" className="text-button first-run-restore" disabled={finish.isPending} onClick={() => setRestoring(true)}>
      <KeyRound size={15} aria-hidden="true" />{t("recovery.haveProfile")}
    </button>
    <div className="first-run-friends-actions">
      <button type="button" className="secondary-button" disabled={finish.isPending} onClick={onDone}>{t("firstRun.later")}</button>
      <button type="submit" className="primary-button" disabled={finish.isPending || !name.trim()}>
        {finish.isPending ? <LoaderCircle className="is-spinning" size={16} /> : <Check size={16} />}
        {t("firstRun.done")}
      </button>
    </div>
  </form>;
}

function errorCode(error: unknown): string {
  if (typeof error === "string") return error;
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
}
