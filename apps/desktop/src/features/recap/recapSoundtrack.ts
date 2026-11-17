import type { RecapSlideId } from "./recapPlan";
import type { ListeningRecap } from "./recapTypes";

/** Songs further down may be one-off autoplay finds; fillers stay with these. */
const FAMILIAR_TOP = 5;

/**
 * Which song plays under which page, like Wrapped: the top song opens and
 * carries the first pages, later pages bring the song they are about. The
 * same song on neighbouring pages keeps playing instead of starting over, and
 * no song comes back later: a page that would repeat one takes the next
 * top-five song not heard yet, or keeps the current one running. The summary
 * never switches, the story ends on what is playing.
 */
export function soundtrackPlan(slides: RecapSlideId[], recap: ListeningRecap): (string | undefined)[] {
  const top = recap.overview.topTracks.map((entry) => entry.track);
  const familiar = top.slice(0, FAMILIAR_TOP);
  const artist = recap.overview.topArtists[0]?.creator.name.toLowerCase();
  const byTopArtist = artist
    ? top.find((track) => track.creators.some((creator) => creator.name.toLowerCase() === artist))
    : undefined;
  const pick = (index: number) => familiar[Math.min(index, familiar.length - 1)]?.uri;
  const bySlide: Record<RecapSlideId, string | undefined> = {
    intro: pick(0),
    time: pick(0),
    topTrack: pick(0),
    topTracks: pick(1),
    topArtist: byTopArtist?.uri ?? pick(2),
    discoveries: recap.topDiscovery?.track.uri ?? pick(3),
    onRepeat: recap.onRepeat?.track.uri ?? pick(3),
    rhythm: pick(2),
    places: pick(3),
    summary: undefined,
  };
  const used = new Set<string>();
  let previous: string | undefined;
  return slides.map((slide) => {
    const wanted = bySlide[slide];
    if (!wanted || wanted === previous) return previous;
    const uri = used.has(wanted) ? familiar.find((track) => !used.has(track.uri))?.uri : wanted;
    if (!uri) return previous;
    used.add(uri);
    previous = uri;
    return uri;
  });
}

/**
 * Clips follow the player's volume, clearly below the song. The player's
 * slider works by ear (60 % is much quieter than half the loudness), an audio
 * element's volume is plain amplitude, and Spotify's clips are not levelled
 * like the songs and come out louder. Hence the curve and the low ceiling.
 * A muted player keeps the story silent.
 */
export function soundtrackVolume(playerVolume: number | undefined): number {
  const volume = Number.isFinite(playerVolume) ? Math.min(1, Math.max(0, playerVolume!)) : 0.5;
  return Math.min(0.5, volume ** 2.5 * 0.55);
}

const SOUND_KEY = "luftify.recaps.sound.v1";

export function recapSoundPreferred(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function rememberRecapSound(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Only a convenience: the next story starts with sound again.
  }
}
