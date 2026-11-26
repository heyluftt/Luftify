import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const current = () => document.documentElement.dataset.theme;

/** The theme id on the root (`luft.pixelpop`, …), updated when it changes. */
export function useActiveTheme(): string | undefined {
  return useSyncExternalStore(subscribe, current, current);
}
