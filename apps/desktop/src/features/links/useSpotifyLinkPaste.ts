import { useEffect } from "react";
import { useUiStore } from "../../stores/uiStore";
import { parseSpotifyLink } from "./spotifyLink";

/**
 * Ctrl+V with a Spotify link anywhere outside a text field opens it in the
 * palette: Enter plays, Shift+Enter opens the page, Ctrl+Enter queues.
 */
export function useSpotifyLinkPaste(): void {
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditable(event.target)) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!parseSpotifyLink(text)) return;
      event.preventDefault();
      useUiStore.getState().openCommandPaletteWith(text.trim());
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
