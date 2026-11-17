// WebView2 still ships the browser page menu (print, reload, save, inspect).
// App menus call preventDefault themselves; this only hides the leftover chrome.

export function suppressWebPageControls(target: EventTarget = document): () => void {
  const onContextMenu = (event: Event) => {
    event.preventDefault();
  };
  const onKeyDown = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || !isBrowserPageShortcut(event)) return;
    event.preventDefault();
  };
  target.addEventListener("contextmenu", onContextMenu);
  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("contextmenu", onContextMenu);
    target.removeEventListener("keydown", onKeyDown);
  };
}

function isBrowserPageShortcut(event: KeyboardEvent): boolean {
  const command = event.ctrlKey || event.metaKey;
  if (event.key === "F5" || event.key === "F12") {
    return !import.meta.env.DEV;
  }
  if (!command) return false;
  if (event.code === "KeyP" || event.code === "KeyS" || event.code === "KeyU") {
    return true;
  }
  if (!import.meta.env.DEV && event.shiftKey && event.code === "KeyI") {
    return true;
  }
  return !import.meta.env.DEV && event.code === "KeyR";
}
