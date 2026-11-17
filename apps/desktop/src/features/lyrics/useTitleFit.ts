import { useLayoutEffect, type RefObject } from "react";

const MIN_SCALE = 0.55;

/**
 * Shrinks a large title until its longest word fits one line. Long single
 * words ("Weltuntergangsstimmung") otherwise break mid-word. Sets
 * `--title-fit` on the element; CSS multiplies the font size with it.
 */
export function useTitleFit(ref: RefObject<HTMLElement | null>, text: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let lastWidth = -1;

    const fit = () => {
      const available = element.clientWidth;
      if (available === lastWidth) return;
      lastWidth = available;
      element.style.setProperty("--title-fit", "1");
      const widest = widestWordWidth(element, text);
      const scale = widest > available && widest > 0
        ? Math.max(MIN_SCALE, (available / widest) * 0.98)
        : 1;
      element.style.setProperty("--title-fit", scale.toFixed(3));
    };

    fit();
    if (typeof ResizeObserver === "undefined") return;
    // Watch the width only; the height changes with the font size itself.
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, text]);
}

function widestWordWidth(element: HTMLElement, text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const style = getComputedStyle(element);
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0";
  probe.style.font = style.font;
  probe.style.letterSpacing = style.letterSpacing;
  document.body.appendChild(probe);
  let widest = 0;
  for (const word of words) {
    probe.textContent = word;
    widest = Math.max(widest, probe.getBoundingClientRect().width);
  }
  probe.remove();
  return widest;
}
