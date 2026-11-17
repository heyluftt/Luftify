// Share one observer across cover tiles without changing the preload distance.
const callbacks = new Map<Element, () => void>();
let observer: IntersectionObserver | undefined;

function release(element: Element) {
  callbacks.delete(element);
  observer?.unobserve(element);
  if (!callbacks.size) {
    observer?.disconnect();
    observer = undefined;
  }
}

export function observeCoverVisibility(element: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onVisible();
    return () => {};
  }
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = callbacks.get(entry.target);
      if (!callback) continue;
      release(entry.target);
      callback();
    }
  }, { rootMargin: "960px" });
  callbacks.set(element, onVisible);
  observer.observe(element);
  return () => {
    if (callbacks.get(element) === onVisible) release(element);
  };
}
