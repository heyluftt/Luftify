import { motionLevel } from "./motionLevel";

/**
 * Signature effect "Cover-Flug" (DESIGN.md): play on a card, and when the
 * song starts its cover flies in an arc into the player bar and lands there.
 * A click only remembers where the cover was; the flight starts when the
 * player bar actually shows the new song (PlayerBar → useCoverLanding).
 */

/** A launch older than this (slow start, Spotify limit) just fades in normally. */
const LAUNCH_TTL_MS = 6_000;
const FLIGHT_MS = 680;
const LAND_MS = 420;

/**
 * Play buttons on cards, and where their cover is. Only cards: track rows
 * and playlist pages start music all the time, a flight there would tire.
 */
const LAUNCHERS: Array<{ button: string; art: (button: Element) => HTMLElement | null | undefined }> = [
  {
    button: ".ds-tile-play:not(.is-playing)",
    art: (button) => button.closest(".ds-tile, .ds-row-tile")
      ?.querySelector<HTMLElement>(".ds-tile-art > :first-child, .ds-row-tile-open > :first-child"),
  },
  { button: ".mix-card-play", art: (button) => button.closest(".mix-card")?.querySelector<HTMLElement>(".mix-cover-grid") },
];

interface Launch {
  art: HTMLElement;
  at: number;
}

interface Flight {
  /** The player bar cover it lands on; a quick second song change moves it. */
  target: HTMLElement;
}

let launch: Launch | undefined;
let flight: Flight | undefined;

/** Remembers the cover behind a play button. Installed once (main.tsx). */
export function trackCoverLaunches(): void {
  document.addEventListener("click", (event) => {
    const clicked = event.target as Element | null;
    // Any other click (a track row, the next card) replaces the launch.
    launch = undefined;
    for (const { button, art } of LAUNCHERS) {
      const hit = clicked?.closest?.(button);
      if (!hit) continue;
      const cover = art(hit);
      if (cover) launch = { art: cover, at: performance.now() };
      return;
    }
  }, true);
}

/** Takes the pending launch, if it is still fresh and the cover still on screen. */
function takeLaunch(): HTMLElement | undefined {
  const pending = launch;
  launch = undefined;
  if (!pending || performance.now() - pending.at > LAUNCH_TTL_MS) return undefined;
  if (!pending.art.isConnected) return undefined;
  const rect = pending.art.getBoundingClientRect();
  const onScreen = rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  return onScreen ? pending.art : undefined;
}

/**
 * Flies the launched cover onto `target` (the player bar cover). Returns
 * false when there is nothing to fly, so the caller keeps its own entrance.
 */
export function flyCoverTo(target: HTMLElement): boolean {
  if (flight) {
    // The song changed again mid-flight (e.g. the queue settled): the cover
    // keeps flying and lands on the new player bar cover in the same place.
    hideTarget(target);
    flight.target = target;
    return true;
  }
  const source = takeLaunch();
  if (!source || motionLevel() !== "full" || typeof target.animate !== "function") return false;
  hideTarget(target);
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!to.width || !from.width) {
    showTarget(target);
    delete target.dataset.landing;
    return false;
  }

  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const scale = to.width / from.width;

  // Two layers: the outer one travels sideways at an even pace, the inner
  // one first lifts a little and then drops, so together they draw an arc.
  const carrier = document.createElement("div");
  carrier.className = "cover-flight";
  carrier.setAttribute("aria-hidden", "true");
  Object.assign(carrier.style, { left: `${from.left}px`, top: `${from.top}px` });
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("role");
  ghost.removeAttribute("aria-label");
  ghost.classList.add("cover-flight-art");
  Object.assign(ghost.style, {
    width: `${from.width}px`,
    height: `${from.height}px`,
    borderRadius: getComputedStyle(source).borderRadius,
  });
  carrier.append(ghost);
  document.body.append(carrier);

  const timing = { duration: FLIGHT_MS, fill: "forwards" as const };
  const animations = [
    carrier.animate({ translate: ["0 0", `${dx}px 0`] }, { ...timing, easing: "cubic-bezier(.35, 0, .25, 1)" }),
    ghost.animate({ translate: ["0 0", `0 ${dy}px`] }, { ...timing, easing: "cubic-bezier(.5, -0.45, .7, 1)" }),
    ghost.animate({ scale: [1, scale] }, { ...timing, easing: "cubic-bezier(.4, 0, .2, 1)" }),
    ghost.animate({ rotate: ["0deg", "-10deg", "4deg"] }, { ...timing, easing: "ease-in-out" }),
  ];

  const current: Flight = { target };
  const finish = (land: boolean) => {
    if (flight !== current) return;
    flight = undefined;
    animations.forEach((animation) => animation.cancel());
    carrier.remove();
    const landing = current.target;
    showTarget(landing);
    if (land && landing.isConnected) {
      // It lands with a little squash and settles.
      landing.animate(
        { scale: [.78, 1.12, .97, 1], rotate: ["4deg", "-2deg", "0deg", "0deg"] },
        { duration: LAND_MS, easing: "cubic-bezier(.3, .7, .4, 1)" },
      );
    }
  };
  flight = current;
  void animations[0]!.finished.then(() => finish(true), () => finish(false));
  return true;
}

/**
 * Hidden while the copy flies. `data-landing` also keeps its own entrance
 * (styles/motion/lively.css) from skewing the measurement or playing after
 * the landing; the element exists once per song.
 */
function hideTarget(target: HTMLElement) {
  target.dataset.landing = "";
  target.style.opacity = "0";
}

function showTarget(target: HTMLElement) {
  target.style.removeProperty("opacity");
}
