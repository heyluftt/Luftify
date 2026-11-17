import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut } from "lucide-react";
import { LibrespotOutputSettings } from "./LibrespotOutputSettings";
import { LibrespotPlaybackQuality } from "./LibrespotPlaybackQuality";
import { LibrespotAccountSwitcher } from "./LibrespotAccountSwitcher";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import type {
  LibrespotStatus,
  LoudnessNormalization,
  StreamingQuality,
} from "../../types/tauri";
import { LIBRESPOT_STATUS_QUERY_KEY } from "../playback/usePlaybackEngine";
import { SettingsGroup } from "./SettingsPrimitives";

/** Libre account, output device and stream quality: the whole playback engine section. */
export function LibreSessionSection({
  outputDevice,
  quality,
  loudness,
  onOutputDevice,
  onQuality,
  onLoudness,
}: {
  outputDevice: string;
  quality: StreamingQuality;
  loudness: LoudnessNormalization;
  onOutputDevice: (device: string | null) => void;
  onQuality: (quality: StreamingQuality) => void;
  onLoudness: (loudness: LoudnessNormalization) => void;
}) {
  const client = useQueryClient();
  const outputs = useQuery({
    queryKey: ["audio-outputs"],
    queryFn: desktopApi.audioOutputs,
    staleTime: 8_000,
    retry: false,
  });
  const statusQuery = useQuery({
    queryKey: LIBRESPOT_STATUS_QUERY_KEY,
    queryFn: desktopApi.librespotStatus,
    refetchInterval: 2_000,
  });
  const login = useMutation({
    mutationFn: desktopApi.startLibrespotLogin,
    onSuccess: (status) => {
      client.setQueryData(LIBRESPOT_STATUS_QUERY_KEY, status);
      void client.invalidateQueries({ queryKey: ["librespot-accounts"] });
      void statusQuery.refetch();
      return status;
    },
    onError: () => {
      void statusQuery.refetch();
    },
  });
  const logout = useMutation({
    mutationFn: desktopApi.logoutLibrespot,
    onSuccess: (status) => {
      client.setQueryData(LIBRESPOT_STATUS_QUERY_KEY, status);
      void client.invalidateQueries({ queryKey: ["librespot-accounts"] });
      void statusQuery.refetch();
      return status;
    },
    onError: () => {
      void statusQuery.refetch();
    },
  });
  const status = statusQuery.data;
  const switching = status?.phase === "connecting" || login.isPending || logout.isPending;
  return (
    <SettingsGroup
      title={t("settings.engine.title")}
      description={t("settings.engine.hint")}
    >
      <LibrespotStatusPanel
        status={status}
        pending={login.isPending || logout.isPending}
        error={
          login.isError
            ? commandErrorMessage(login.error, t("settings.libre.signInError"))
            : logout.isError
              ? commandErrorMessage(logout.error, t("settings.libre.signOutError"))
              : null
        }
        onLogin={() => { logout.reset(); login.mutate(); }}
        onLogout={() => { login.reset(); logout.mutate(); }}
      />
      <LibrespotAccountSwitcher
        disabled={login.isPending || logout.isPending || status?.phase === "authenticating" || status?.phase === "connecting"}
      />
      <LibrespotOutputSettings
        enabled
        selected={outputDevice}
        outputs={outputs.data ?? []}
        loading={outputs.isFetching}
        failed={outputs.isError}
        switching={switching}
        onRefresh={() => void outputs.refetch()}
        onSelect={onOutputDevice}
      />
      <LibrespotPlaybackQuality
        enabled
        switching={switching}
        quality={quality}
        loudness={loudness}
        onQuality={onQuality}
        onLoudness={onLoudness}
      />
    </SettingsGroup>
  );
}

function LibrespotStatusPanel({
  status,
  pending,
  error,
  onLogin,
  onLogout,
}: {
  status: LibrespotStatus | undefined;
  pending: boolean;
  error: string | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const phase = status?.phase ?? "disconnected";
  const label = librespotPhaseLabel(phase);
  const canLogout = Boolean(status?.credentialsPresent) || phase === "ready";
  const detail = error ?? (phase === "ready"
    ? (status?.message ?? t("settings.libre.signedIn"))
    : (status?.message ?? t("settings.libre.loading")));
  return (
    <div className="settings-actions-panel">
      <div>
        <strong>{t("settings.libre.session", { label })}</strong>
        <small role={error ? "alert" : undefined}>
          {detail}
          {status?.username ? ` · ${status.username}` : ""}
        </small>
        {phase === "error" && (
          <p className="settings-inline-hint">{t("settings.libre.failed")}</p>
        )}
      </div>
      <div className="spotify-window-actions">
        <button type="button" className="secondary-button" disabled={pending || phase === "authenticating" || phase === "connecting"} onClick={onLogin}>
          <LogIn size={16} />{pending && (phase === "authenticating" || phase === "connecting") ? t("settings.libre.connecting") : t("settings.libre.signIn")}
        </button>
        <button type="button" className="secondary-button danger" disabled={pending || !canLogout} onClick={onLogout}>
          <LogOut size={16} />{t("settings.libre.signOut")}
        </button>
      </div>
    </div>
  );
}

function commandErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

function librespotPhaseLabel(phase: LibrespotStatus["phase"]) {
  switch (phase) {
    case "ready":
      return t("chip.ready");
    case "authenticating":
      return t("settings.libre.authenticating");
    case "connecting":
      return t("settings.libre.connectingPhase");
    case "needsLogin":
      return t("chip.needsLogin");
    case "error":
      return t("chip.error");
    default:
      return t("chip.disconnected");
  }
}
