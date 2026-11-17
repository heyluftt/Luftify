import { DevicesPanel } from "../friends/devices/DevicesPanel";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../../services/desktopApi";
import { t } from "../../i18n";
import { ProfileAvatar } from "../listen-together/ProfileAvatar";
import { profileImage } from "./profileImage";
import { SectionHeading } from "./SettingsPrimitives";
import { RecoveryCodePanel } from "../friends/recovery/RecoveryCodePanel";
import "../../styles/pages/profile-settings.css";

export function ProfileSettings({ embedded = false }: { embedded?: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings });
  const saved = query.data?.listenTogether;
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setName(saved?.displayName ?? ""); setAvatar(saved?.avatarUri ?? null); }, [saved?.displayName, saved?.avatarUri]);
  useEffect(() => () => { generation.current++; }, []);
  const save = useMutation({
    mutationFn: () => desktopApi.saveListenProfile(name.trim(), avatar),
    onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }),
  });
  const dirty = name.trim() !== (saved?.displayName ?? "") || avatar !== (saved?.avatarUri ?? null);
  const busy = save.isPending || loading;
  return <section id="settings-profile" className="settings-section profile-settings">
    {embedded
      ? <p className="settings-inline-hint">{t("settingsUi.profileHint")}</p>
      : <SectionHeading index="09" title={t("settingsUi.nav.profile")} description={t("settingsUi.profileHint")} />}
    <form onSubmit={event => { event.preventDefault(); if (!busy && name.trim() && dirty) save.mutate(); }}>
      <div className="profile-image-controls">
        <ProfileAvatar name={name} uri={avatar} />
        <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={busy}
          onChange={async event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
            if (!file) return;
            const current = ++generation.current;
            setLoading(true); setError(false); save.reset();
            try { const image = await profileImage(file); if (current === generation.current) setAvatar(image); }
            catch { if (current === generation.current) setError(true); }
            finally { if (current === generation.current) setLoading(false); }
          }} />
        <button type="button" className="secondary-button" disabled={busy} onClick={() => input.current?.click()}>{t("listen.profileChoose")}</button>
        {avatar && <button type="button" className="secondary-button" disabled={busy} onClick={() => { generation.current++; setAvatar(null); setError(false); save.reset(); }}>{t("listen.profileRemove")}</button>}
      </div>
      <label htmlFor="listen-profile-name">{t("listen.profileName")}</label>
      <input id="listen-profile-name" value={name} maxLength={32} autoComplete="nickname" disabled={busy || !query.data} placeholder={t("listen.profileName")}
        onChange={event => { setName(event.currentTarget.value); save.reset(); }} />
      <button type="submit" className="primary-button" disabled={busy || !query.data || !name.trim() || !dirty}>{t(save.isPending ? "listen.saving" : "listen.save")}</button>
      <p role="status">{error ? t("listen.profileImageError") : save.isError || query.isError ? t("listen.saveError") : save.isSuccess ? t("listen.profileSaved") : loading ? t("listen.profilePreparing") : ""}</p>
    </form>
    {!embedded && <DevicesPanel />}
    {!embedded && <RecoveryCodePanel />}
  </section>;
}
