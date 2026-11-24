import { createElement, lazy, type ComponentType } from "react";
import type { EntityKind } from "../features/entities/entityTypes";

/**
 * A code-split page that renders straight away once its chunk is loaded.
 * `React.lazy` alone suspends on the first render even when the module is
 * already in memory, which flashed the loading state on every first visit.
 */
function preloadablePage<P extends object>(load: () => Promise<Record<string, unknown>>, name: string) {
  let loaded: ComponentType<P> | undefined;
  const preload = () => load().then((module) => {
    loaded = module[name] as ComponentType<P>;
    return loaded;
  });
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));
  function Page(props: P) {
    return loaded ? createElement(loaded, props) : createElement(Lazy as ComponentType<P>, props);
  }
  Page.displayName = `Page(${name})`;
  return { Page, preload };
}

const search = preloadablePage(() => import("./SearchPage"), "SearchPage");
const library = preloadablePage<{ likedOnly?: boolean }>(() => import("./LibraryPage"), "LibraryPage");
const entity = preloadablePage<{ kind: EntityKind }>(() => import("./EntityPage"), "EntityPage");
const lyrics = preloadablePage(() => import("./LyricsPage"), "LyricsPage");
const queue = preloadablePage(() => import("./QueuePage"), "QueuePage");
const insights = preloadablePage(() => import("./InsightsPage"), "InsightsPage");
const recaps = preloadablePage(() => import("./RecapsPage"), "RecapsPage");
const listen = preloadablePage(() => import("./ListenTogetherPage"), "ListenTogetherPage");
const friends = preloadablePage(() => import("./FriendsPage"), "FriendsPage");
const messages = preloadablePage(() => import("./MessagesPage"), "MessagesPage");
const settings = preloadablePage(() => import("./SettingsPage"), "SettingsPage");
const modules = preloadablePage(() => import("./ModulesPage"), "ModulesPage");
const audio = preloadablePage(() => import("./AudioControlPage"), "AudioControlPage");
const diagnostics = preloadablePage(() => import("./DiagnosticsPage"), "DiagnosticsPage");

export const SearchPage = search.Page;
export const LibraryPage = library.Page;
export const EntityPage = entity.Page;
export const LyricsPage = lyrics.Page;
export const QueuePage = queue.Page;
export const InsightsPage = insights.Page;
export const RecapsPage = recaps.Page;
export const ListenTogetherPage = listen.Page;
export const FriendsPage = friends.Page;
export const MessagesPage = messages.Page;
export const SettingsPage = settings.Page;
export const ModulesPage = modules.Page;
export const AudioControlPage = audio.Page;
export const DiagnosticsPage = diagnostics.Page;

// Most likely next page first; the sidebar order after that.
const PRELOAD_ORDER = [library, search, entity, lyrics, queue, insights, recaps, listen, friends, messages, settings, modules, audio, diagnostics];

/**
 * Loads every page chunk after start, one per idle slot so parsing never
 * competes with the first interactions. The mini player never calls this.
 */
export function prefetchPages(): void {
  const pending = [...PRELOAD_ORDER];
  const next = () => {
    const page = pending.shift();
    if (!page) return;
    void page.preload().catch(() => undefined).finally(() => schedule(next));
  };
  schedule(next);
}

/** Loads every page chunk at once; the start waits for it behind its indicator. */
export function preloadAllPages(): Promise<void> {
  return Promise.allSettled(PRELOAD_ORDER.map((page) => page.preload())).then(() => undefined);
}

function schedule(work: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(work, { timeout: 2_500 });
  } else {
    window.setTimeout(work, 200);
  }
}
