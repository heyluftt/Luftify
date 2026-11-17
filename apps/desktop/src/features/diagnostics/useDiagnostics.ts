import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { t, type MessageKey } from "../../i18n";
import { desktopApi, type DiagnosticsExport } from "../../services/desktopApi";
import type { Settings } from "../../types/tauri";
import { LIBRESPOT_STATUS_QUERY_KEY } from "../playback/usePlaybackEngine";
import { APP_CONNECTION_QUERY_KEY } from "../spotify/useAppConnection";
import { diagnosticState, type DiagnosticState } from "./diagnosticState";

export interface DiagnosticsContext {
  state: DiagnosticState;
  libre: ReturnType<typeof useQuery<Awaited<ReturnType<typeof desktopApi.librespotStatus>>>>["data"];
  settings: Settings | undefined;
  listen: Awaited<ReturnType<typeof desktopApi.listenTogetherStatus>> | undefined;
  mockMode: boolean;
  activeError: boolean;
  refreshing: boolean;
  badgeState: "online" | "offline" | "warning" | "mock";
  badgeLabel: string;
  refreshAll: () => void;
  connect: () => void;
  connecting: boolean;
  connectError: string | null;
  exportReport: () => void;
  exporting: boolean;
  exportResult: DiagnosticsExport | undefined;
  exportError: boolean;
  revealReport: (path: string) => void;
  copyPath: (path: string) => void;
  pathCopied: boolean;
}

export function useDiagnostics(): DiagnosticsContext {
  const client = useQueryClient();
  const connection = useQuery({
    queryKey: APP_CONNECTION_QUERY_KEY,
    queryFn: desktopApi.connectionInfo,
    staleTime: 2_000,
    retry: false,
  });
  const libre = useQuery({
    queryKey: LIBRESPOT_STATUS_QUERY_KEY,
    queryFn: desktopApi.librespotStatus,
    staleTime: 2_000,
    retry: false,
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: desktopApi.settings,
    staleTime: 30_000,
    retry: false,
  });
  const listen = useQuery({
    queryKey: ["listen-together-status"],
    queryFn: desktopApi.listenTogetherStatus,
    staleTime: 2_000,
    retry: false,
  });
  const mockMode = connection.data?.mockMode === true;
  const activeError = connection.isError || (!mockMode && libre.isError);
  const refreshing = connection.isFetching || libre.isFetching || listen.isFetching;
  const state = diagnosticState({
    libre: libre.data,
    mockMode,
    pending: connection.isPending || (!mockMode && libre.isPending),
    error: activeError,
  });
  const connect = useMutation({
    mutationFn: desktopApi.startLibrespotLogin,
    onSuccess: (status) => {
      client.setQueryData(LIBRESPOT_STATUS_QUERY_KEY, status);
      void libre.refetch();
    },
    onError: () => {
      void libre.refetch();
    },
  });
  const exportReport = useMutation({ mutationFn: desktopApi.exportDiagnostics });
  const reveal = useMutation({ mutationFn: desktopApi.revealDiagnosticsReport });
  const [pathCopied, setPathCopied] = useState(false);
  const copyPath = useCallback((path: string) => {
    void navigator.clipboard?.writeText(path).then(() => {
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1_600);
    }).catch(() => undefined);
  }, []);
  const refreshAll = useCallback(() => {
    void connection.refetch();
    void libre.refetch();
    void listen.refetch();
    void settings.refetch();
  }, [connection, libre, listen, settings]);

  const badge = badgeFor(state.status);
  return {
    state,
    libre: libre.data,
    settings: settings.data,
    listen: listen.data,
    mockMode,
    activeError,
    refreshing,
    badgeState: badge.state,
    badgeLabel: t(badge.labelKey),
    refreshAll,
    connect: () => connect.mutate(),
    connecting: connect.isPending,
    connectError: connect.isError ? errorMessage(connect.error) : null,
    exportReport: () => exportReport.mutate(),
    exporting: exportReport.isPending,
    exportResult: exportReport.data,
    exportError: exportReport.isError,
    revealReport: (path) => reveal.mutate(path),
    copyPath,
    pathCopied,
  };
}

function badgeFor(status: DiagnosticState["status"]): { state: "online" | "offline" | "warning" | "mock"; labelKey: MessageKey } {
  switch (status) {
    case "ok":
      return { state: "online", labelKey: "diagnostics.healthy" };
    case "demo":
      return { state: "mock", labelKey: "diagnostics.demo" };
    case "checking":
      return { state: "warning", labelKey: "diagnostics.checking" };
    case "offline":
      return { state: "offline", labelKey: "diagnostics.disconnected" };
    default:
      return { state: "warning", labelKey: "diagnostics.statusUnknown" };
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return t("diagnostics.actionError");
}
