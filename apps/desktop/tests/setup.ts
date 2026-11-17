import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
});

Object.defineProperty(window.navigator, "language", {
  configurable: true,
  value: "de-DE",
});

