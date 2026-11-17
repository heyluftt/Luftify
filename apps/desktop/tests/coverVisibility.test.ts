import { afterEach, expect, it, vi } from "vitest";
import { observeCoverVisibility } from "../src/components/coverVisibility";

const entry = (target: Element, isIntersecting: boolean): IntersectionObserverEntry => ({
  target, isIntersecting, time: 0, intersectionRatio: isIntersecting ? 1 : 0,
  boundingClientRect: target.getBoundingClientRect(),
  intersectionRect: target.getBoundingClientRect(), rootBounds: null,
});
afterEach(() => vi.unstubAllGlobals());

it("shares the preload observer and releases visible and unmounted tiles", () => {
  let notify!: IntersectionObserverCallback;
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();
  const constructor = vi.fn(function (callback: IntersectionObserverCallback) {
    notify = callback;
    return { observe, unobserve, disconnect };
  });
  vi.stubGlobal("IntersectionObserver", constructor);
  const first = document.createElement("div");
  const second = document.createElement("div");
  const onFirst = vi.fn();
  const onSecond = vi.fn();
  const stopFirst = observeCoverVisibility(first, onFirst);
  const stopSecond = observeCoverVisibility(second, onSecond);
  try {
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(constructor).toHaveBeenCalledWith(expect.any(Function), { rootMargin: "960px" });
    expect(observe).toHaveBeenCalledTimes(2);
    notify([entry(first, false)], {} as IntersectionObserver);
    expect(onFirst).not.toHaveBeenCalled();
    notify([entry(first, true)], {} as IntersectionObserver);
    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(unobserve).toHaveBeenCalledWith(first);
    expect(disconnect).not.toHaveBeenCalled();
    stopSecond();
    expect(disconnect).toHaveBeenCalledTimes(1);
    // Late notifications after cleanup must not start work.
    notify([entry(second, true)], {} as IntersectionObserver);
    expect(onSecond).not.toHaveBeenCalled();
    stopFirst();
    expect(disconnect).toHaveBeenCalledTimes(1);
    const stopAgain = observeCoverVisibility(first, onFirst);
    expect(constructor).toHaveBeenCalledTimes(2);
    stopAgain();
  } finally { stopFirst(); stopSecond(); }
});

it("loads immediately when visibility observation is unavailable", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const onVisible = vi.fn();
  const stop = observeCoverVisibility(document.createElement("div"), onVisible);
  expect(onVisible).toHaveBeenCalledTimes(1);
  stop();
});
