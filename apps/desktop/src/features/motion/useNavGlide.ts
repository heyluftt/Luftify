import { useLayoutEffect, useRef, type RefObject } from "react";

/** Matches the glide transition in styles/motion/lively.css. */
const GLIDE_MS = 480;

interface Slot {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * On a route change a highlight springs from the previous active entry of
 * `nav` to the new one (`.nav-glide`); then the entry shows its theme's own
 * active style again.
 */
export function useNavGlide(navRef: RefObject<HTMLElement | null>, routeKey: string) {
  const last = useRef<Slot | undefined>(undefined);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const glide = nav?.querySelector<HTMLElement>(".nav-glide");
    const active = nav?.querySelector<HTMLElement>(".nav-item.active");
    const next = active ? slotOf(active) : undefined;
    const previous = last.current;
    last.current = next;
    if (!nav || !glide || !next || !previous || previous.top === next.top) return;

    glide.style.transition = "none";
    place(glide, previous);
    glide.classList.add("is-visible");
    nav.classList.add("is-gliding");
    void glide.offsetWidth;
    glide.style.removeProperty("transition");
    place(glide, next);

    const done = () => {
      nav.classList.remove("is-gliding");
      glide.classList.remove("is-visible");
    };
    const timer = window.setTimeout(done, GLIDE_MS);
    return () => {
      window.clearTimeout(timer);
      done();
    };
  }, [navRef, routeKey]);
}

function slotOf(element: HTMLElement): Slot {
  return { top: element.offsetTop, left: element.offsetLeft, width: element.offsetWidth, height: element.offsetHeight };
}

function place(glide: HTMLElement, slot: Slot) {
  glide.style.left = `${slot.left}px`;
  glide.style.width = `${slot.width}px`;
  glide.style.height = `${slot.height}px`;
  glide.style.transform = `translateY(${slot.top}px)`;
}
