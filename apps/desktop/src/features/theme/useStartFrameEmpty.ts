import { useSyncExternalStore } from "react";

/** While the start shows the empty content frame (styles/components/start-flow.css). */
export function startFrameIsEmpty(): boolean {
  const root = document.documentElement;
  return root.hasAttribute("data-start") && !root.hasAttribute("data-start-main");
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-start", "data-start-main"] });
  return () => observer.disconnect();
}

export function useStartFrameEmpty(): boolean {
  return useSyncExternalStore(subscribe, startFrameIsEmpty, startFrameIsEmpty);
}
