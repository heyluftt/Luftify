import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { desktopApi } from "../services/desktopApi";
import { applyThemeMode, normalizeThemeMode, rememberThemeMode } from "../themes/theme";
import type { Settings } from "../types/tauri";
import { DEFAULT_AUDIO_CONTROL_SETTINGS } from "../features/audio-control/audioControl";
import { DEFAULT_LYRICS_VISUAL_SETTINGS } from "../features/lyrics/lyricsVisualSettings";
import { AppearanceSettings } from "../features/settings/AppearanceSettings";
import { ProfileSettings } from "../features/settings/ProfileSettings";
import { HomeSettings } from "../features/settings/HomeSettings";
import { LifecycleSettings } from "../features/settings/LifecycleSettings";
import { LyricsSettings } from "../features/settings/LyricsSettings";
import { MiniPlayerSettings } from "../features/settings/MiniPlayerSettings";
import { NotificationSettings } from "../features/settings/NotificationSettings";
import { PlaybackSettings } from "../features/settings/PlaybackSettings";
import { PrivacySettings } from "../features/settings/PrivacySettings";
import { SettingsSectionNav } from "../features/settings/SettingsSectionNav";
import { ShortcutSettings } from "../features/settings/ShortcutSettings";
import { DEFAULT_LISTEN_TOGETHER } from "../features/listen-together/listenTogetherTypes";
import { DEFAULT_MINIPLAYER_SETTINGS } from "../features/miniplayer/miniplayerSettings";

const initialSettings: Settings = {
  theme: "dark",
  reconnectResumeMode: "ifWasPlaying",
  closeBehavior: "minimizeToTray",
  windowsAutostart: false,
  startInTrayOnAutostart: false,
  lastRoute: "/",
  searchHistoryEnabled: true,
  nowPlayingListNavigationEnabled: true,
  listeningAnalyticsEnabled: true,
  homeFeatureMode: "lastPlayed",
  homeFeaturePlaylistUri: null,
  lyricsEnabled: true,
  songVideosEnabled: false,
  experimentalLibreCanvas: false,
  lyricsVisuals: DEFAULT_LYRICS_VISUAL_SETTINGS,
  audioControl: DEFAULT_AUDIO_CONTROL_SETTINGS,
  miniplayer: DEFAULT_MINIPLAYER_SETTINGS,
  librespotAudioDevice: null,
  librespotStreamingQuality: "high",
  librespotLoudness: "off",
  listenTogether: DEFAULT_LISTEN_TOGETHER,
};

export function SettingsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings });
  const [draft, setDraft] = useState<Settings>(initialSettings);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const previousSettings = useRef<Settings>(initialSettings);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!query.data) return;
    if (!settingsHydrated) {
      previousSettings.current = query.data;
      draftRef.current = query.data;
      dirtyRef.current = false;
      setDraft(query.data);
      setSettingsHydrated(true);
      return;
    }
    const previous = previousSettings.current;
    previousSettings.current = query.data;
    setDraft((current) => {
      if (dirtyRef.current || !settingsAreEqual(current, previous)) return current;
      draftRef.current = query.data;
      return query.data;
    });
  }, [query.data, settingsHydrated]);
  const [justSaved, setJustSaved] = useState(false);
  const save = useMutation({
    mutationFn: persistSettings,
    onSuccess: (settings) => {
      setJustSaved(true);
      previousSettings.current = settings;
      client.setQueryData(["settings"], settings);
      if (!pageSettingsDiffer(draftRef.current, settings)) {
        dirtyRef.current = false;
      }
    },
  });
  const { mutate, isPending } = save;
  const resetUsage = useMutation({
    mutationFn: desktopApi.resetPlaylistUsage,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["playlist-usage"] }),
  });
  const playlistOptions = useQuery({
    queryKey: ["settings-playlist-options"],
    queryFn: loadPlaylistOptions,
    enabled: draft.homeFeatureMode === "fixed",
    retry: false,
  });
  useEffect(() => {
    if (!settingsHydrated || isPending || !dirtyRef.current) return;
    const saved = query.data;
    if (saved && !pageSettingsDiffer(draft, saved)) {
      dirtyRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => mutate(draft), 180);
    return () => window.clearTimeout(timer);
  }, [draft, isPending, mutate, query.data, settingsHydrated]);
  // "Saved" shows briefly; an idle bar only covered the settings below it.
  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [justSaved]);
  if (!settingsHydrated) {
    return (
      <div className="page settings-loading-state" aria-busy={!query.isError}>
        <div className="page-heading">
          <h1>{t("nav.settings")}</h1>
          <p>
            {query.isError
              ? t("settings.loadError")
              : t("settings.loading")}
          </p>
          {query.isError && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void query.refetch()}
            >
              {t("settings.retry")}
            </button>
          )}
        </div>
      </div>
    );
  }
  const isDirty = dirtyRef.current && (!query.data || pageSettingsDiffer(draft, query.data));
  const isSaving = isPending || isDirty;
  const saveFailed = save.isError;
  const saveSucceeded = save.isSuccess;
  const saveMessage = isSaving
    ? t("settings.saving")
    : saveFailed
      ? t("settings.saveFailed")
      : saveSucceeded
        ? t("settings.saved")
        : t("settings.upToDate");
  const saveBarVisible = isSaving || saveFailed || justSaved;

  const patchDraft = (patch: Partial<Settings>) => {
    setDraft((value) => {
      const next = { ...value, ...patch };
      draftRef.current = next;
      dirtyRef.current = true;
      return next;
    });
  };
  const selectTheme = (value: string) => {
    const theme = rememberThemeMode(value);
    applyThemeMode(theme);
    patchDraft({ theme });
  };
  const toggle = (key: BooleanSettingKey) => (checked: boolean) => patchDraft({ [key]: checked });

  return (
    <div className="page settings-page">
      <aside className="settings-aside">
        <div className="page-heading settings-heading">
          <h1>{t("nav.settings")}</h1>
        </div>
        <SettingsSectionNav />
      </aside>

      <main className="settings-content">
        <PlaybackSettings settings={draft} onPatch={patchDraft} />
        <AppearanceSettings
          selected={normalizeThemeMode(draft.theme)}
          nowPlayingListNavigationEnabled={draft.nowPlayingListNavigationEnabled}
          onSelect={selectTheme}
          onNowPlayingListNavigationEnabled={toggle("nowPlayingListNavigationEnabled")}
        />
        <LyricsSettings
          visualSettings={draft.lyricsVisuals}
          lyricsEnabled={draft.lyricsEnabled}
          experimentalLibreCanvas={draft.experimentalLibreCanvas === true}
          onVisualSettings={(lyricsVisuals) => patchDraft({ lyricsVisuals })}
          onLyricsEnabled={toggle("lyricsEnabled")}
          onExperimentalLibreCanvas={toggle("experimentalLibreCanvas")}
        />
        <HomeSettings
          settings={draft}
          playlists={playlistOptions.data?.items ?? []}
          resetPending={resetUsage.isPending}
          resetDone={resetUsage.isSuccess}
          onMode={(homeFeatureMode) => patchDraft({ homeFeatureMode })}
          onPlaylist={(homeFeaturePlaylistUri) => patchDraft({ homeFeaturePlaylistUri: homeFeaturePlaylistUri || null })}
          onReset={() => resetUsage.mutate()}
        />
        <LifecycleSettings settings={draft} onPatch={patchDraft} />
        <MiniPlayerSettings />
        <PrivacySettings
          searchHistoryEnabled={draft.searchHistoryEnabled}
          listeningAnalyticsEnabled={draft.listeningAnalyticsEnabled}
          onSearchHistoryEnabled={toggle("searchHistoryEnabled")}
          onListeningAnalyticsEnabled={toggle("listeningAnalyticsEnabled")}
        />
        <NotificationSettings value={draft.notifications} onChange={(notifications) => patchDraft({ notifications })} />
        <ProfileSettings />
        <ShortcutSettings audio={{ ...DEFAULT_AUDIO_CONTROL_SETTINGS, ...draft.audioControl }} />

        <div className={`settings-save-bar${isDirty || isPending ? " dirty" : ""}${saveBarVisible ? " is-visible" : ""}${saveFailed ? " failed" : ""}`}>
          <span role="status">{saveMessage}</span>
          {saveFailed && (
            <button type="button" className="primary-button" onClick={() => mutate(draft)}>
              {t("settings.saveRetry")}
            </button>
          )}
        </div>

        <p className="settings-dedication" lang="en">
          for <span>A2</span>; always.
        </p>
      </main>
    </div>
  );
}

function settingsAreEqual(first: Settings, second: Settings) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function pageSettingsDiffer(first: Settings, second: Settings) {
  return JSON.stringify(ownedSettings(first)) !== JSON.stringify(ownedSettings(second));
}

function ownedSettings(settings: Settings) {
  const { miniplayer: _miniplayer, lastRoute: _lastRoute, audioControl: _audioControl, ...owned } = settings;
  return owned;
}

async function persistSettings(settings: Settings) {
  const current = await desktopApi.settings();
  const next = {
    ...settings,
    miniplayer: current.miniplayer,
    lastRoute: current.lastRoute,
    audioControl: current.audioControl,
  };
  if (settingsAreEqual(next, current)) return next;
  await desktopApi.saveSettings(next);
  return next;
}

async function loadPlaylistOptions() {
  const cached = await desktopApi.cachedPlaylists({ offset: 0, limit: 50 });
  try {
    return await desktopApi.playlists({ offset: 0, limit: 100 });
  } catch (error: unknown) {
    if (cached) return cached;
    throw error;
  }
}

type BooleanSettingKey = {
  [K in keyof Settings]-?: Settings[K] extends boolean ? K : never
}[keyof Settings];
