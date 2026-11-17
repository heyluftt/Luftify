import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { desktopApi } from "../../services/desktopApi";
import { nextRepeatMode } from "../../stores/playerStore";
import { useUiStore } from "../../stores/uiStore";
import { applyThemeMode, rememberThemeMode, type ThemeMode } from "../../themes/theme";
import type { Settings } from "../../types/tauri";
import { DEFAULT_AUDIO_CONTROL_SETTINGS, applyDspSettings, getRuntimeAudioControlSettings, setAudioPreset } from "../audio-control/audioControl";
import { EQUALIZER_PRESETS, applyEqualizerPreset } from "../audio-control/equalizerPresets";
import { SPATIAL_PRESETS, applySpatialPreset } from "../audio-control/spatialPresets";
import { playLibraryContext, playLibraryTrack } from "../entities/entityPlayback";
import { albumDestination, contextDestination } from "../entities/mediaDestinations";
import { copyText, spotifyOpenUrl } from "../entities/spotifyLinks";
import { LIKED_COLLECTION_URI } from "../library/libraryPresentation";
import { useLikedLibrary } from "../library/libraryQueries";
import { playbackCommands } from "../playback/playbackCommands";
import { usePlayback } from "../playback/usePlayback";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { rememberSearchPick } from "../search/searchHistory";
import { searchEntityPath } from "../search/useSearchHitActions";
import type { PaletteItem, PaletteMedia } from "./paletteTypes";

/** Enter plays or runs, Shift+Enter opens the page, Ctrl+Enter queues a song. */
export type PaletteRunMode = "primary" | "open" | "queue";

export function usePaletteRunner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setQueueOpen = useUiStore((store) => store.setQueueOpen);
  const player = usePlayback();
  const { localReady } = usePlaybackEngine();
  const liked = useLikedLibrary();
  const mode = localReady ? "librespot" : "desktop";

  const runMedia = async (media: PaletteMedia, how: PaletteRunMode) => {
    if (media.kind === "liked") {
      if (how === "open") navigate("/liked");
      else playLibraryContext(LIKED_COLLECTION_URI, liked.view.data?.items, player, mode);
      return;
    }
    if (media.kind === "track") {
      const { track } = media;
      rememberSearchPick({ kind: "tracks", track });
      if (how === "queue") {
        await desktopApi.addToQueue(track.uri, track);
        return;
      }
      if (how === "open") {
        const album = albumDestination(track);
        if (album) navigate(album.path, album.summary ? { state: album.summary } : undefined);
        return;
      }
      if (mode === "librespot") playLibraryTrack(track, player, media.context, "librespot");
      else player.playUri(track.uri);
      return;
    }
    rememberSearchPick({ kind: media.category, entry: media.entry });
    if (how === "open" || media.category === "artists") {
      navigate(searchEntityPath(media.category, media.entry.uri), { state: media.entry });
      return;
    }
    player.playUri(media.entry.uri);
  };

  return async (item: PaletteItem, how: PaletteRunMode = "primary"): Promise<void> => {
    const action = item.action;
    switch (action.kind) {
      case "media":
        return runMedia(action.media, how);
      case "link":
        if (action.link.kind === "track") player.playUri(action.link.uri);
        else navigate(searchEntityPath(`${action.link.kind}s`, action.link.uri));
        return;
      case "search":
        navigate(action.query ? `/search?q=${encodeURIComponent(action.query)}` : "/search");
        return;
      case "navigate":
        navigate(action.path, action.state ? { state: action.state } : undefined);
        return;
      case "volume":
        setAudioPreset(action.percent, getRuntimeAudioControlSettings().curve);
        return;
      case "seek":
        playbackCommands.previewSeek(action.ms);
        playbackCommands.commitSeek();
        return;
      case "theme":
        return persistTheme(action.mode, queryClient);
      case "equalizer": {
        const preset = EQUALIZER_PRESETS.find((entry) => entry.id === action.presetId);
        if (!preset) return;
        const settings = currentAudioSettings();
        return applyDspSettings(queryClient, {
          ...settings,
          dsp: { ...applyEqualizerPreset(settings.dsp, preset), enabled: true },
        });
      }
      case "room": {
        const preset = SPATIAL_PRESETS.find((entry) => entry.presetId === action.presetId);
        if (!preset) return;
        const settings = currentAudioSettings();
        return applyDspSettings(queryClient, {
          ...settings,
          dsp: { ...settings.dsp, spatial: applySpatialPreset(preset) },
        });
      }
      case "command":
        return runCommand(action.id);
    }
  };

  async function runCommand(id: string) {
    const playback = player.playback;
    const current = playback?.currentItem;
    switch (id) {
      case "queue-panel":
        setQueueOpen(true);
        return;
      case "miniplayer":
        await desktopApi.showMiniplayer();
        return;
      case "copy-link": {
        const url = spotifyOpenUrl(current?.uri);
        if (url) await copyText(url);
        return;
      }
      case "open-album": {
        const album = current ? albumDestination(current) : undefined;
        if (album) navigate(album.path, album.summary ? { state: album.summary } : undefined);
        return;
      }
      case "open-artist": {
        const artist = current?.creators.find((creator) => creator.uri?.startsWith("spotify:artist:"));
        if (artist?.uri) navigate(searchEntityPath("artists", artist.uri), { state: { uri: artist.uri, name: artist.name } });
        return;
      }
      case "open-context": {
        const destination = contextDestination(playback?.contextUri);
        if (destination) navigate(destination.path, destination.summary ? { state: destination.summary } : undefined);
        return;
      }
      case "mute":
        playbackCommands.send({ command: "toggleMute" });
        return;
    }
    if (!playback) return;
    switch (id) {
      case "play-toggle":
        playbackCommands.send({ command: playback.isPlaying ? "pause" : "play" });
        return;
      case "next":
      case "previous":
        playbackCommands.send({ command: id });
        return;
      case "like":
        playbackCommands.send({ command: "toggleLike" });
        return;
      case "shuffle":
        playbackCommands.send({ command: "setShuffle", enabled: !playback.shuffleEnabled });
        return;
      case "repeat":
        playbackCommands.send({ command: "setRepeat", repeatMode: nextRepeatMode(playback.repeatMode) });
    }
  }
}

function currentAudioSettings() {
  const settings = getRuntimeAudioControlSettings();
  return { ...settings, dsp: settings.dsp ?? DEFAULT_AUDIO_CONTROL_SETTINGS.dsp };
}

async function persistTheme(mode: ThemeMode, queryClient: QueryClient) {
  applyThemeMode(rememberThemeMode(mode));
  const current =
    queryClient.getQueryData<Settings>(["settings"]) ??
    await desktopApi.settings().catch(() => undefined);
  if (!current || current.theme === mode) {
    if (current) queryClient.setQueryData(["settings"], { ...current, theme: mode });
    return;
  }
  const next = { ...current, theme: mode };
  await desktopApi.saveSettings(next);
  queryClient.setQueryData(["settings"], next);
}
