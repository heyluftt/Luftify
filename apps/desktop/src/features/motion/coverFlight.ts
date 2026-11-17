import { motionLevel } from "./motionLevel";

/**
 * Signature effect "Cover-Flug" (DESIGN.md): play on a card, and when the
 * song starts its cover flies in an arc into the player bar and lands there.
 * A click only remembers where the cover was; the flight starts when the
 * player bar actually shows the new song (PlayerBar → flyCoverTo).
 */

/** A launch older than this (slow start, Spotify limit) just fades in normally. */
const LAUNCH_TTL_MS = 6_000;
const FLIGHT_MS = 680;
const LAND_MS = 420;

const LAUNCHERS = ".ds-tile-play:not(.is-playing)";
const ARTWORK = ".ds-tile-art > :first-child, .ds-row-tile-open > :first-child";

interface Launch {
  art: HTMLElement;
  at: number;
}

let launch: Launch | undefined;
let running: (() => void) | undefined;

/** Remembers the cover behind a card's play button. Installed once (main.tsx). */
export function trackCoverLaunches(): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest?.(LAUNCHERS);
    const card = button?.closest(".ds-tile, .ds-row-tile");
    const art = card?.querySelector<HTMLElement>(ARTWORK);
    launch = art ? { art, at: performance.now() } : undefined;
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
  running?.();
  const source = takeLaunch();
  if (!source || motionLevel() !== "full" || typeof target.animate !== "function") return false;
  // Its own entrance (styles/motion/lively.css) would skew the measurement
  // and must not play after the landing either; the element is per song.
  target.dataset.landing = "";
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!to.width || !from.width) {
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
  target.style.opacity = "0";

  const timing = { duration: FLIGHT_MS, fill: "forwards" as const };
  const flight = [
    carrier.animate({ translate: ["0 0", `${dx}px 0`] }, { ...timing, easing: "cubic-bezier(.35, 0, .25, 1)" }),
    ghost.animate({ translate: ["0 0", `0 ${dy}px`] }, { ...timing, easing: "cubic-bezier(.5, -0.45, .7, 1)" }),
    ghost.animate({ scale: [1, scale] }, { ...timing, easing: "cubic-bezier(.4, 0, .2, 1)" }),
    ghost.animate({ rotate: ["0deg", "-10deg", "4deg"] }, { ...timing, easing: "ease-in-out" }),
  ];

  let done = false;
  const finish = (land: boolean) => {
    if (done) return;
    done = true;
    running = undefined;
    flight.forEach((animation) => animation.cancel());
    carrier.remove();
    target.style.removeProperty("opacity");
    if (land) {
      // It lands with a little squash and settles.
      target.animate(
        { scale: [.78, 1.12, .97, 1], rotate: ["4deg", "-2deg", "0deg", "0deg"] },
        { duration: LAND_MS, easing: "cubic-bezier(.3, .7, .4, 1)" },
      );
    }
  };
  running = () => finish(false);
  void flight[0]!.finished.then(() => finish(true), () => finish(false));
  return true;
}
