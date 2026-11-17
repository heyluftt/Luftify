import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Search } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { useUiStore } from "../../stores/uiStore";
import type { ThemeMode } from "../../themes/theme";
import { DEFAULT_AUDIO_CONTROL_SETTINGS, useAudioControlSettings } from "../audio-control/audioControl";
import { usePlaybackConnected } from "../playback/usePlayback";
import { usePlayerStore } from "../../stores/playerStore";
import { PALETTE_GROUP_LABEL, buildCommandCatalog, groupPaletteItems, moveSelection } from "./commandPaletteModel";
import { originalPaletteId, paletteUsageBoost, recentPaletteItems, rememberPaletteRun } from "./paletteHistory";
import { paletteIntents } from "./paletteIntents";
import { assemblePaletteItems, parsePaletteQuery } from "./paletteItems";
import { PaletteNowPlaying } from "./PaletteNowPlaying";
import { PaletteRow } from "./PaletteRow";
import { mediaCanOpen, mediaCanQueue, type PaletteItem } from "./paletteTypes";
import { parseSpotifyLink } from "../links/spotifyLink";
import { usePaletteLink } from "./usePaletteLink";
import { usePaletteMedia } from "./usePaletteMedia";
import { usePaletteRunner, type PaletteRunMode } from "./usePaletteRunner";

const FOCUSABLE =
  "button:not([disabled]):not([tabindex='-1']), input:not([disabled]), [tabindex]:not([tabindex='-1'])";
const NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"]);

export function CommandPalette() {
  const open = useUiStore((store) => store.commandPaletteOpen);
  const setOpen = useUiStore((store) => store.setCommandPaletteOpen);
  const location = useLocation();
  const connected = usePlaybackConnected();
  // The palette stays mounted while closed; it follows playback only when open.
  const playback = usePlayerStore((store) => open ? store.playback : undefined);
  const audio = useAudioControlSettings();
  // Older stored settings can lack the DSP block; the palette must still open.
  const dsp = audio.dsp ?? DEFAULT_AUDIO_CONTROL_SETTINGS.dsp;
  const settings = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings, staleTime: 30_000, enabled: open });
  const run = usePaletteRunner();
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  /** Follows the row, not the index, once the user picked one: late Spotify results must not move it. */
  const [picked, setPicked] = useState<string | undefined>();
  const [history, setHistory] = useState(0);
  /** Only keyboard moves scroll the list; hovering must not make it jump. */
  const keyboardMove = useRef(false);

  const { text, commandsOnly } = parsePaletteQuery(query);
  const link = useMemo(() => commandsOnly ? undefined : parseSpotifyLink(text), [commandsOnly, text]);
  const linked = usePaletteLink(link, open);
  const typed = useMemo(() => paletteIntents(text, playback, connected), [connected, playback, text]);
  const intents = link ? linked : typed;
  // "laut 40", "1:30" or a pasted link is an action, not something to look up.
  const media = usePaletteMedia(commandsOnly || intents.length > 0 ? "" : text, open, connected);
  const catalog = useMemo(
    () => buildCommandCatalog({
      pathname: location.pathname,
      connected,
      soundEnabled: audio.enabled,
      ...(dsp.enabled ? { equalizerPresetId: dsp.presetId } : {}),
      roomPresetId: dsp.spatial?.enabled ? dsp.spatial.presetId : "direct",
      ...(settings.data?.theme ? { theme: settings.data.theme as ThemeMode } : {}),
      ...(playback ? { playback } : {}),
    }),
    [audio.enabled, connected, dsp, location.pathname, playback, settings.data?.theme],
  );
  // `history` changes after a run, so "Zuletzt" is current the next time.
  const items = useMemo(() => assemblePaletteItems({
    query,
    catalog,
    recent: open ? recentPaletteItems(catalog) : [],
    intents,
    suggested: media.suggested,
    library: media.library,
    spotify: media.spotify,
    boost: paletteUsageBoost(history),
  }), [catalog, history, intents, media.library, media.spotify, media.suggested, open, query]);
  const groups = useMemo(() => groupPaletteItems(items), [items]);
  const pickedIndex = picked ? items.findIndex((item) => item.id === picked) : -1;
  const selected = pickedIndex >= 0 ? pickedIndex : 0;
  const active = items[selected];

  const startQuery = useUiStore((store) => store.paletteQuery);
  useEffect(() => {
    if (!open) return;
    setQuery(startQuery);
    setPicked(undefined);
  }, [open, startQuery]);

  useEffect(() => {
    setPicked(undefined);
    if (results.current) results.current.scrollTop = 0;
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.requestAnimationFrame(() => input.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        // The first Escape clears a typed query, the second closes.
        if (input.current?.value) setQuery("");
        else setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open || !active || !keyboardMove.current) return;
    keyboardMove.current = false;
    const list = results.current;
    const row = document.getElementById(`palette-option-${active.id}`);
    if (!list || !row) return;
    // Wrapping around lands on the very first or last row: show the list's
    // real start or end, heading and padding included, not the row flush
    // against the edge.
    if (selected === 0) {
      list.scrollTop = 0;
      return;
    }
    if (selected === items.length - 1) {
      list.scrollTop = list.scrollHeight;
      return;
    }
    // A group's first row brings its heading along.
    const heading = row.previousElementSibling;
    if (heading?.tagName === "H2") heading.scrollIntoView?.({ block: "nearest" });
    row.scrollIntoView?.({ block: "nearest" });
  }, [open, active, selected, items.length]);

  if (typeof document === "undefined") return null;

  const execute = (item: PaletteItem | undefined, how: PaletteRunMode = "primary") => {
    if (!item || item.disabled) return;
    const mode = how === "queue" && !mediaCanQueue(item) ? "primary" : how === "open" && !mediaCanOpen(item) ? "primary" : how;
    rememberPaletteRun({ ...item, id: originalPaletteId(item.id) });
    setHistory((value) => value + 1);
    setOpen(false);
    void run(item, mode).catch(() => undefined);
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (NAVIGATION_KEYS.has(event.key)) {
      if ((event.key === "Home" || event.key === "End") && query) return;
      event.preventDefault();
      const next = moveSelection(selected, items.length, event.key as Parameters<typeof moveSelection>[2]);
      keyboardMove.current = true;
      setPicked(items[next]?.id);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      execute(active, event.ctrlKey || event.metaKey ? "queue" : event.shiftKey ? "open" : "primary");
      return;
    }
    if (event.key === "Tab" && dialog.current) {
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const searching = !commandsOnly && text.length >= 2 && (media.searching || media.pending) && media.spotify.length === 0;
  // The loader stands where Spotify's results will appear.
  const loaderBefore = groups.find((group) => group.group === "commands-late" || group.group === "search")?.group;
  return createPortal(
    <div
      className={`command-palette-backdrop${open ? " is-open" : ""}`}
      role="presentation"
      aria-hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={dialog}
        className={`command-palette${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
      >
        <form
          className="command-palette-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            execute(active);
          }}
        >
          {media.searching ? <LoaderCircle size={18} className="is-spinning" aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
          <label className="sr-only" htmlFor="command-palette-input" id="command-palette-title">
            {t("command.searchOrRun")}
          </label>
          <input
            id="command-palette-input"
            ref={input}
            value={query}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={active ? `palette-option-${active.id}` : undefined}
            placeholder={t("command.placeholder")}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onInputKeyDown}
          />
          {commandsOnly && <span className="command-palette-scope">{t("command.commandsOnly")}</span>}
          <kbd>Esc</kbd>
        </form>

        {!text && open && <PaletteNowPlaying />}

        <div
          id="command-palette-results"
          ref={results}
          className="command-palette-results"
          role="listbox"
          aria-label={t("command.commands")}
        >
          {items.length === 0 && <p className="command-palette-empty">{t("command.empty")}</p>}
          {groups.map((group) => (
            <section key={group.group} className="command-palette-group" aria-label={t(PALETTE_GROUP_LABEL[group.group])}>
              {searching && group.group === loaderBefore && <SearchingRow />}
              {group.group !== "search" && <h2>{t(PALETTE_GROUP_LABEL[group.group])}</h2>}
              {group.items.map((item) => (
                <PaletteRow
                  key={item.id}
                  item={item}
                  active={item === active}
                  onHover={() => { if (item !== active) setPicked(item.id); }}
                  onRun={(event) => execute(item, event.ctrlKey || event.metaKey ? "queue" : event.shiftKey ? "open" : "primary")}
                />
              ))}
            </section>
          ))}
        </div>

        <footer className="command-palette-footer">
          <span className="command-palette-tip">
            {text ? <><kbd>&gt;</kbd> {t("command.commandsOnly")}</> : t("command.tip")}
          </span>
          <span className="command-palette-keys">
            <kbd>↑</kbd><kbd>↓</kbd> {t("command.footerChoose")}
            {mediaCanOpen(active) && <><span aria-hidden="true">·</span><kbd>⇧</kbd><kbd>↵</kbd> {t("command.action.open")}</>}
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function SearchingRow() {
  return (
    <p className="command-palette-searching" role="status">
      <LoaderCircle size={14} className="is-spinning" aria-hidden="true" /> {t("command.searching")}
    </p>
  );
}
