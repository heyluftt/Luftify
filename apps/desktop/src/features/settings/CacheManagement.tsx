import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Database, Image, ListMusic, Trash2, Type } from "lucide-react";
import { useState } from "react";
import { appLanguage, t, type MessageKey } from "../../i18n";
import {
  desktopApi,
  type CacheScope,
  type CacheUsageSection,
} from "../../services/desktopApi";
import { clearLyricsFallbacks } from "../lyrics/lyricsFallbackCache";

const cacheActions = [
  { scope: "lyrics", labelKey: "settings.cache.clearLyrics", icon: Type },
  { scope: "playlists", labelKey: "settings.cache.clearPlaylists", icon: ListMusic },
  { scope: "covers", labelKey: "settings.cache.clearCovers", icon: Image },
] satisfies Array<{ scope: CacheScope; labelKey: MessageKey; icon: typeof Type }>;

export function CacheManagement() {
  const client = useQueryClient();
  const [confirmAll, setConfirmAll] = useState(false);
  const usage = useQuery({
    queryKey: ["cache-storage-usage"],
    queryFn: desktopApi.cacheUsage,
    staleTime: 15_000,
  });
  const clear = useMutation({
    mutationFn: desktopApi.clearCache,
    onSuccess: (_result, scope) => {
      clearFrontendCacheQueries(client, scope);
      void usage.refetch();
    },
  });

  return (
    <div className="settings-cache-panel">
      <div className="settings-cache-copy">
        <span className="setting-icon"><Database /></span>
        <span>
          <strong>{t("settings.cache.title")}</strong>
          <small>{t("settings.cache.hint")}</small>
        </span>
      </div>
      <div className="settings-cache-actions">
        {cacheActions.map(({ scope, labelKey, icon: Icon }) => {
          const section = usage.data?.[scope];
          return (
            <button
              key={scope}
              type="button"
              className="secondary-button"
              disabled={clear.isPending}
              onClick={() => {
                setConfirmAll(false);
                clear.mutate(scope);
              }}
            >
              <Icon size={15} />
              <span className="settings-cache-action-label">{t(labelKey)}</span>
              <CacheSize section={section} pending={usage.isPending} />
            </button>
          );
        })}
        <button
          type="button"
          className="secondary-button danger"
          disabled={clear.isPending}
          aria-controls="settings-cache-confirmation"
          aria-expanded={confirmAll}
          onClick={() => {
            clear.reset();
            setConfirmAll(true);
          }}
        >
          <Trash2 size={15} />
          <span className="settings-cache-action-label">{t("settings.cache.clearAll")}</span>
          <CacheSize section={usage.data?.total} pending={usage.isPending} />
        </button>
        {confirmAll && (
          <div
            id="settings-cache-confirmation"
            className="settings-cache-confirmation"
            role="group"
            aria-labelledby="settings-cache-confirmation-title"
          >
            <span>
              <strong id="settings-cache-confirmation-title">{t("settings.cache.confirm")}</strong>
            </span>
            <span className="settings-cache-confirmation-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirmAll(false)}>{t("close.cancel")}</button>
              <button
                type="button"
                className="secondary-button danger"
                onClick={() => {
                  setConfirmAll(false);
                  clear.mutate("all");
                }}
              >
                {t("settings.cache.confirmYes")}
              </button>
            </span>
          </div>
        )}
      </div>
      {(clear.isPending || clear.isSuccess || clear.isError) && (
        <span className={clear.isError ? "settings-cache-status error" : "settings-cache-status"} role="status">
          {clear.isPending
            ? t("settings.cache.clearing")
            : clear.isSuccess
              ? t("settings.cache.cleared", { n: clear.data.removedEntries })
              : t("settings.cache.clearError")}
        </span>
      )}
    </div>
  );
}

function CacheSize({
  pending,
  section,
}: {
  pending: boolean;
  section: CacheUsageSection | undefined;
}) {
  const entries = section?.entries ?? 0;
  const title = section
    ? t(entries === 1 ? "settings.cache.entry" : "settings.cache.entries", { n: entries })
    : pending
      ? t("settings.cache.sizePending")
      : t("settings.cache.sizeUnavailable");

  return (
    <span className="settings-cache-size" title={title}>
      {section ? formatCacheSize(section.bytes) : pending ? "…" : "–"}
    </span>
  );
}

export function formatCacheSize(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = safeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const maximumFractionDigits = unitIndex > 0 && value < 10 ? 1 : 0;
  const locale = appLanguage() === "en" ? "en-US" : "de-DE";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)} ${units[unitIndex]}`;
}

export function clearFrontendCacheQueries(client: QueryClient, scope: CacheScope): void {
  if (scope === "lyrics" || scope === "all") {
    client.removeQueries({ queryKey: ["lyrics"] });
    clearLyricsFallbacks();
  }
  if (scope === "playlists" || scope === "all") {
    client.removeQueries({ queryKey: ["library-cache", "playlists"] });
    client.removeQueries({ queryKey: ["playlist-snapshot-cache"] });
    client.removeQueries({ queryKey: ["playback-context-playlist-cache"] });
  }
  if (scope === "covers" || scope === "all") {
    client.removeQueries({ queryKey: ["cover"] });
  }
  if (scope === "all") {
    client.removeQueries({ queryKey: ["library-cache"] });
  }
}
