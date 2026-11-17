import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";
import { useListenRoomState } from "../listen-together/guestLock";
import { playbackCommands } from "../playback/playbackCommands";
import { soundtrackVolume } from "./recapSoundtrack";

const FADE_IN_MS = 900;
const FADE_OUT_MS = 450;

const fades = new WeakMap<HTMLAudioElement, number>();

/**
 * Timer-driven on purpose: animation frames stop while the window is hidden
 * or minimised, and a clip must still fade out and stop then.
 */
function fadeTo(audio: HTMLAudioElement, target: number, duration: number): Promise<void> {
  window.clearInterval(fades.get(audio));
  const from = audio.volume;
  const started = performance.now();
  return new Promise((resolve) => {
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / duration);
      audio.volume = Math.min(1, Math.max(0, from + (target - from) * progress));
      if (progress < 1) return;
      window.clearInterval(timer);
      if (fades.get(audio) === timer) fades.delete(audio);
      resolve();
    }, 30);
    fades.set(audio, timer);
  });
}

/** Whether a clip should be sounding; a fade that ends late must not undo a resume. */
const wanted = new WeakMap<HTMLAudioElement, boolean>();

function resume(audio: HTMLAudioElement, volume: number) {
  wanted.set(audio, true);
  void audio.play().then(() => {
    if (wanted.get(audio)) void fadeTo(audio, volume, FADE_IN_MS);
  }).catch(() => undefined);
}

/** Fades out and pauses, keeping the position for a later return (sound off and on). */
function hush(audio: HTMLAudioElement) {
  wanted.set(audio, false);
  const end = () => {
    if (wanted.get(audio)) return;
    window.clearInterval(fades.get(audio));
    fades.delete(audio);
    audio.pause();
  };
  // Background timers can be throttled; the clip ends on time regardless.
  const fallback = window.setTimeout(end, FADE_OUT_MS + 250);
  void fadeTo(audio, 0, FADE_OUT_MS).then(() => {
    window.clearTimeout(fallback);
    end();
  });
}

function unload(audio: HTMLAudioElement) {
  wanted.set(audio, false);
  window.clearInterval(fades.get(audio));
  fades.delete(audio);
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

/**
 * Plays Spotify's 30-second clips under the story, one per page, cross-faded.
 * The clips run beside the player, so queue and listening stats stay as they
 * were; the player pauses meanwhile and continues when the story closes. Off in a
 * listening room, where pausing would stop everyone.
 */
export function useRecapSoundtrack({ plan, index, enabled }: {
  plan: (string | undefined)[];
  index: number;
  enabled: boolean;
}) {
  const inRoom = useListenRoomState((state) => state.locked);
  const [released, setReleased] = useState(false);
  const uris = useMemo(() => [...new Set(plan.filter((uri): uri is string => Boolean(uri)))], [plan]);
  const clips = useQuery({
    queryKey: ["recap", "clips", uris.join(",")],
    queryFn: () => desktopApi.trackPreviews(uris),
    enabled: enabled && !inRoom && uris.length > 0,
    staleTime: 30 * 60_000,
    retry: false,
  });
  const urls = useMemo(
    () => new Map((clips.data ?? []).flatMap((clip) => (clip.url ? [[clip.uri, clip.url] as const] : []))),
    [clips.data],
  );
  const available = urls.size > 0;
  const active = enabled && !inRoom && !released && available;
  const volume = soundtrackVolume(usePlayerStore((store) => store.playback?.volume));
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // The player rests once the soundtrack has started and picks up again when
  // the story closes; "sound off" only silences, it does not bring it back.
  // Resuming waits a moment: an immediate remount (StrictMode) keeps the
  // player paused instead of a pause, play, pause stutter.
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (active) setEngaged(true);
  }, [active]);
  const holdPlayer = engaged && !released;
  const resumeRef = useRef(false);
  const resumeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!holdPlayer) return;
    if (resumeTimer.current !== undefined) {
      window.clearTimeout(resumeTimer.current);
      resumeTimer.current = undefined;
    } else {
      const wasPlaying = usePlayerStore.getState().playback?.isPlaying === true;
      if (wasPlaying) playbackCommands.send({ command: "pause" });
      resumeRef.current = wasPlaying;
    }
    return () => {
      if (!resumeRef.current) return;
      resumeTimer.current = window.setTimeout(() => {
        resumeTimer.current = undefined;
        if (!resumeRef.current) return;
        resumeRef.current = false;
        playbackCommands.send({ command: "play" });
      }, 80);
    };
  }, [holdPlayer]);

  // One element per song, so a song paused by "sound off" continues where it was.
  const cache = useRef(new Map<string, HTMLAudioElement>());
  const current = useRef<string | undefined>(undefined);
  const uri = active ? plan[index] : undefined;
  const url = uri ? urls.get(uri) : undefined;
  useEffect(() => {
    if (current.current === uri) return;
    const previous = current.current ? cache.current.get(current.current) : undefined;
    if (previous) hush(previous);
    current.current = uri;
    if (!uri || !url) return;
    let audio = cache.current.get(uri);
    if (!audio) {
      audio = new Audio(url);
      audio.loop = true;
      audio.volume = 0;
      cache.current.set(uri, audio);
    }
    resume(audio, volumeRef.current);
  }, [uri, url]);

  useEffect(() => {
    const audio = current.current ? cache.current.get(current.current) : undefined;
    if (audio && wanted.get(audio) && !audio.paused) void fadeTo(audio, volume, 200);
  }, [volume]);

  const unloadTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    // A remount right away (StrictMode) keeps the clips.
    window.clearTimeout(unloadTimer.current);
    const clips = cache.current;
    return () => {
      // Quiet fade for the one playing, then everything is let go.
      const playing = current.current ? clips.get(current.current) : undefined;
      if (playing) hush(playing);
      current.current = undefined;
      unloadTimer.current = window.setTimeout(() => {
        clips.forEach(unload);
        clips.clear();
      }, FADE_OUT_MS + 300);
    };
  }, []);

  /** The user starts music of their own: stop the clips, no resume later. */
  const release = useCallback(() => {
    resumeRef.current = false;
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = undefined;
    setReleased(true);
  }, []);

  return {
    active,
    /** Worth offering the sound switch: clips exist, or have not been asked for. */
    offered: !inRoom && !released && (!enabled || clips.isFetching || available),
    release,
  };
}
