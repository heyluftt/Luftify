import type { MediaItem } from "@luft/protocol-types";
import { ChevronLeft, ChevronRight, LoaderCircle, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { playAnalyticsTrack } from "../analytics/analyticsPlayback";
import type { AnalyticsCreator, AnalyticsTrack } from "../analytics/analyticsTypes";
import { analyticsArtistDisplayKey, useAnalyticsArtistDisplays } from "../analytics/useAnalyticsArtistDisplays";
import { usePlaylistLibrary } from "../library/libraryQueries";
import { usePlaybackActions } from "../playback/usePlayback";
import { DEFAULT_COVER_PALETTE, extractCoverPalette, type CoverPalette } from "../theme/coverPalette";
import { markRecapSeen } from "./recapSeen";
import { recapFacts, recapSlides, type RecapSlideId } from "./recapPlan";
import { IntroSlide, TimeSlide, TopArtistSlide, TopTrackSlide, TopTracksSlide, type RecapSlideProps } from "./RecapSlides";
import { DiscoveriesSlide, OnRepeatSlide, PlacesSlide, RhythmSlide } from "./RecapSlidesMore";
import { SummarySlide } from "./RecapSummary";
import { recapSoundPreferred, rememberRecapSound, soundtrackPlan } from "./recapSoundtrack";
import type { RecapPeriod } from "./recapTypes";
import { useRecapStore } from "./recapStore";
import { useCoverData, useRecap, useRecapCatalog } from "./useRecaps";
import { useRecapSoundtrack } from "./useRecapSoundtrack";
import { prefersLessMotion } from "../motion/motionLevel";

/** How long each page stays before the story moves on. The summary waits. */
const SLIDE_MS: Record<RecapSlideId, number> = {
  intro: 5_500,
  time: 7_000,
  topTrack: 7_500,
  topTracks: 8_500,
  topArtist: 7_500,
  discoveries: 7_000,
  onRepeat: 7_500,
  rhythm: 7_500,
  places: 7_500,
  summary: 0,
};
/** Holding the pointer this long pauses instead of turning the page. */
const HOLD_MS = 260;

function toMediaItem(track: AnalyticsTrack): MediaItem {
  return {
    uri: track.uri,
    source: "spotify",
    itemType: "track",
    title: track.title,
    creators: track.creators.map((creator) => ({ name: creator.name, ...(creator.uri ? { uri: creator.uri } : {}) })),
    ...(track.albumName ? { albumName: track.albumName } : {}),
    ...(track.albumUri ? { albumUri: track.albumUri } : {}),
    ...(track.durationMs ? { durationMs: track.durationMs } : {}),
    ...(track.coverUri ? { coverUri: track.coverUri } : {}),
    explicit: false,
    playable: true,
  };
}

export function RecapStory({ period, onClose }: { period: RecapPeriod; onClose: () => void }) {
  const recap = useRecap(period);
  const facts = useMemo(() => (recap.data ? recapFacts(recap.data, period) : undefined), [period, recap.data]);
  const slides = useMemo(() => (recap.data && facts ? recapSlides(recap.data, period, facts) : []), [facts, period, recap.data]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);
  const [sound, setSound] = useState(recapSoundPreferred);
  const plan = useMemo(() => (recap.data ? soundtrackPlan(slides, recap.data) : []), [recap.data, slides]);
  const soundtrack = useRecapSoundtrack({ plan, index, enabled: sound });
  const toggleSound = () => setSound((value) => { rememberRecapSound(!value); return !value; });
  const dialog = useRef<HTMLDivElement>(null);
  const hold = useRef<{ timer: number; held: boolean } | undefined>(undefined);
  const reducedMotion = prefersLessMotion();

  const coverData = useCoverData(recap.data?.overview.topTracks[0]?.track.coverUri);
  const [palette, setPalette] = useState<CoverPalette>(DEFAULT_COVER_PALETTE);
  useEffect(() => {
    if (!coverData) return;
    let current = true;
    void extractCoverPalette(coverData).then((next) => { if (current) setPalette(next); });
    return () => { current = false; };
  }, [coverData]);

  const artists = useMemo(() => {
    const list = recap.data?.overview.topArtists.slice(0, 5) ?? [];
    const fresh = recap.data?.topNewArtist;
    return fresh ? [...list, fresh] : list;
  }, [recap.data]);
  const displays = useAnalyticsArtistDisplays(artists, Boolean(recap.data));
  const library = usePlaylistLibrary(Boolean(recap.data));
  const playlists = useMemo(() => new Map((library.view.data?.items ?? []).map((item) => [item.uri, item])), [library.view.data?.items]);
  const { playContext, playUri } = usePlaybackActions();
  // Another new recap waiting: the summary offers it, so several in a row play on.
  const nextNew = useRecapCatalog().fresh.find((other) => other.id !== period.id);
  const openRecap = useRecapStore((store) => store.open);

  useEffect(() => markRecapSeen(period.id), [period.id]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);

  const last = Math.max(0, slides.length - 1);
  const go = (next: number) => {
    setIndex(Math.max(0, Math.min(last, next)));
    setPaused(false);
  };
  const replay = () => {
    setIndex(0);
    setPaused(false);
    setRun((value) => value + 1);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      else if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
      else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); setPaused((value) => !value); }
      else if (event.key.toLowerCase() === "m" && soundtrack.offered) { event.preventDefault(); toggleSound(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  const slide = slides[index];
  const props: RecapSlideProps | undefined = recap.data && facts ? {
    recap: recap.data,
    period,
    facts,
    active: true,
    artistImage: (creator: AnalyticsCreator) => displays.get(analyticsArtistDisplayKey(creator))?.imageUri,
    playlistInfo: (uri: string) => {
      const item = playlists.get(uri);
      return item ? { name: item.name, ...(item.coverUri ? { coverUri: item.coverUri } : {}) } : undefined;
    },
    onPlayTrack: (track) => {
      soundtrack.release();
      void playAnalyticsTrack(track, { playContext, playUri });
    },
  } : undefined;

  const autoAdvance = Boolean(slide && SLIDE_MS[slide] > 0 && !reducedMotion);
  const style = {
    "--recap-primary": palette.primary,
    "--recap-secondary": palette.secondary,
    "--recap-highlight": palette.highlight,
    "--recap-shadow": palette.shadow,
    "--recap-angle": `${palette.angle}deg`,
  } as CSSProperties;

  let content: ReactNode;
  if (recap.isError) {
    content = <div className="recap-slide recap-state"><p>{t("recap.story.error")}</p>
      <button type="button" className="recap-action" onClick={(event) => { event.stopPropagation(); void recap.refetch(); }}>{t("recap.story.retry")}</button></div>;
  } else if (!props || !slide) {
    content = <div className="recap-slide recap-state"><LoaderCircle size={28} className="recap-spin" aria-hidden="true" /><p>{t("recap.story.loading")}</p></div>;
  } else {
    content = renderSlide(slide, props, {
      palette,
      coverData,
      onReplay: replay,
      ...(nextNew ? { next: { title: nextNew.title, open: () => openRecap(nextNew) } } : {}),
      onPlayTop: () => {
        const items = recap.data!.overview.topTracks.map((entry) => toMediaItem(entry.track));
        if (!items[0]) return;
        soundtrack.release();
        playUri(items[0].uri, items);
      },
    });
  }

  return createPortal(
    <div className="recap-backdrop" style={style} role="presentation">
      {coverData && <img className="recap-backdrop-art" src={coverData} alt="" aria-hidden="true" />}
      <div
        ref={dialog}
        className="recap-story"
        role="dialog"
        aria-modal="true"
        aria-label={t("recap.story.label", { title: period.title })}
        tabIndex={-1}
        data-slide={slide}
        data-paused={paused}
      >
        <div className="recap-progress" aria-hidden="true">
          {slides.map((id, position) => (
            <span key={`${run}-${id}`} className={position < index ? "is-done" : position === index ? "is-current" : ""}>
              {position === index && autoAdvance && (
                <i
                  style={{ animationDuration: `${SLIDE_MS[id]}ms` }}
                  onAnimationEnd={() => go(index + 1)}
                />
              )}
            </span>
          ))}
        </div>
        <div className="recap-controls">
          {soundtrack.offered && (
            <button type="button" aria-pressed={sound} aria-label={t(sound ? "recap.story.soundOff" : "recap.story.soundOn")} title={t(sound ? "recap.story.soundOff" : "recap.story.soundOn")} onClick={toggleSound}>
              {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          )}
          {autoAdvance && (
            <button type="button" aria-label={t(paused ? "recap.story.resume" : "recap.story.pause")} title={t(paused ? "recap.story.resume" : "recap.story.pause")} onClick={() => setPaused((value) => !value)}>
              {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
            </button>
          )}
          <button type="button" aria-label={t("recap.story.close")} title={t("recap.story.close")} onClick={onClose}><X size={18} /></button>
        </div>
        <div
          key={`${run}-${index}`}
          className="recap-stage"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            const timer = window.setTimeout(() => { hold.current = { timer, held: true }; setPaused(true); }, HOLD_MS);
            hold.current = { timer, held: false };
          }}
          onPointerUp={(event) => {
            const state = hold.current;
            hold.current = undefined;
            if (!state) return;
            window.clearTimeout(state.timer);
            if (state.held) { setPaused(false); return; }
            const bounds = event.currentTarget.getBoundingClientRect();
            go(event.clientX - bounds.left < bounds.width * 0.3 ? index - 1 : index + 1);
          }}
          onPointerLeave={() => {
            if (hold.current) window.clearTimeout(hold.current.timer);
            if (hold.current?.held) setPaused(false);
            hold.current = undefined;
          }}
        >
          {content}
        </div>
        {/* Explained once at the start; it only repeated itself on every page. */}
        {index === 0 && <p className="recap-hint" aria-hidden="true">{t("recap.story.hint")}</p>}
      </div>
      <button type="button" className="recap-nav is-previous" disabled={index === 0} aria-label={t("recap.story.previous")} onClick={() => go(index - 1)}><ChevronLeft size={22} /></button>
      <button type="button" className="recap-nav is-next" disabled={index >= last} aria-label={t("recap.story.next")} onClick={() => go(index + 1)}><ChevronRight size={22} /></button>
    </div>,
    document.body,
  );
}

function renderSlide(
  slide: RecapSlideId,
  props: RecapSlideProps,
  summary: { palette: CoverPalette; coverData: string | undefined; onReplay: () => void; onPlayTop: () => void; next?: { title: string; open: () => void } },
): ReactNode {
  switch (slide) {
    case "intro": return <IntroSlide {...props} />;
    case "time": return <TimeSlide {...props} />;
    case "topTrack": return <TopTrackSlide {...props} />;
    case "topTracks": return <TopTracksSlide {...props} />;
    case "topArtist": return <TopArtistSlide {...props} />;
    case "discoveries": return <DiscoveriesSlide {...props} />;
    case "onRepeat": return <OnRepeatSlide {...props} />;
    case "rhythm": return <RhythmSlide {...props} />;
    case "places": return <PlacesSlide {...props} />;
    case "summary": return <SummarySlide {...props} {...summary} />;
  }
}
