// Focus rings help keyboard navigation but distract mouse users. WebView2 also
// shows them for script focus after a click (menus, restored focus), so track
// the last input modality and let CSS hide rings while the pointer drives.
const NAVIGATION_KEYS = new Set([
  "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown", "F6", "ContextMenu",
]);

export function trackInputModality(root: HTMLElement = document.documentElement) {
  const set = (mode: "pointer" | "keyboard") => {
    if (root.dataset.input !== mode) root.dataset.input = mode;
  };
  set("pointer");
  window.addEventListener("pointerdown", () => set("pointer"), { capture: true, passive: true });
  window.addEventListener("keydown", (event) => {
    if (NAVIGATION_KEYS.has(event.key) || (event.shiftKey && event.key === "F10")) set("keyboard");
  }, { capture: true });
}
