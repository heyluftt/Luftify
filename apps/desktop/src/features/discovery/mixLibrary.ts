import { create } from "zustand";
import { z } from "zod";
import type { DiscoveryPick } from "./discoveryRanking";
import { loadMixes, persistMixes } from "./mixPersistence";

export interface SavedMix {
  id: string;
  createdAt: number;
  name: string;
  pinned: boolean;
  picks: DiscoveryPick[];
}
const KEY = "luft.discovery.library.v1";
const trackSchema = z.object({
  uri: z.string().startsWith("spotify:track:"), title: z.string(),
  source: z.literal("spotify"), itemType: z.literal("track"),
  creators: z.array(z.object({ name: z.string(), uri: z.string().optional() })),
  playable: z.boolean(), explicit: z.boolean(), coverUri: z.string().optional(),
  albumName: z.string().optional(), albumUri: z.string().optional(), durationMs: z.number().optional(),
});
const librarySchema = z.array(z.object({
  id: z.string(), createdAt: z.number().finite(), name: z.string().max(80), pinned: z.boolean(),
  picks: z.array(z.object({ track: trackSchema, novel: z.boolean(), sources: z.number() })).min(1).max(20),
})).max(5);

function read(): SavedMix[] {
  try { return librarySchema.parse(JSON.parse(localStorage.getItem(KEY) ?? "[]")) as SavedMix[]; }
  catch { return []; }
}

export function recentMixTrackUris(mixes: SavedMix[], extra: { track: { uri: string } }[] = [], limit = 3): Set<string> {
  const uris = new Set<string>();
  for (const pick of extra) uris.add(pick.track.uri);
  for (const mix of mixes.slice(0, limit)) {
    for (const pick of mix.picks) uris.add(pick.track.uri);
  }
  return uris;
}

export const MIX_LIMIT = 5;
export const PIN_LIMIT = 4;

// Keep four protected mixes at most, leaving a slot for fresh discoveries.
export function retainMixes(mixes: SavedMix[]): SavedMix[] {
  const pinned = mixes.filter((mix) => mix.pinned).slice(0, PIN_LIMIT);
  const recent = mixes.filter((mix) => !mix.pinned).slice(0, MIX_LIMIT - pinned.length);
  return [...pinned, ...recent].sort((a, b) => b.createdAt - a.createdAt);
}

/** The mix a new one would push out, so the UI can say so before it happens. */
export function replacementCandidate(mixes: SavedMix[]): SavedMix | undefined {
  if (mixes.length < MIX_LIMIT) return undefined;
  const incoming = { id: "", createdAt: Number.MAX_SAFE_INTEGER, name: "", pinned: false, picks: [] };
  const kept = new Set(retainMixes([incoming, ...mixes]).map((mix) => mix.id));
  return mixes.find((mix) => !kept.has(mix.id));
}

interface Library {
  ready: boolean;
  mixes: SavedMix[];
  storageError: boolean;
  add: (picks: DiscoveryPick[]) => void;
  rename: (id: string, name: string) => void;
  togglePin: (id: string) => void;
  remove: (id: string) => SavedMix | undefined;
  /** Undo a removal. Skipped when a newer mix has taken the free slot meanwhile. */
  restore: (mix: SavedMix) => boolean;
}
export const useMixLibrary = create<Library>((set, get) => {
  const save = (mixes: SavedMix[]) => {
    if (!get().ready) return;
    let storageError = false;
    try { localStorage.setItem(KEY, JSON.stringify(mixes)); } catch { storageError = true; }
    set({ mixes, storageError });
    void persistMixes(mixes).then(() => set({ storageError: false }), () => set({ storageError: true, ready: false }));
  };
  return {
    mixes: read(), storageError: false, ready: false,
    add: (picks) => {
      if (!picks.length) return;
      const signature = (items: DiscoveryPick[]) => items.map(({ track }) => track.uri).join("|");
      if (get().mixes.some((mix) => signature(mix.picks) === signature(picks))) return;
      save(retainMixes([{ id: crypto.randomUUID(), createdAt: Date.now(), name: "", pinned: false, picks }, ...get().mixes]));
    },
    rename: (id, name) => {
      const trimmed = name.trim().slice(0, 80);
      const existing = get().mixes.find((mix) => mix.id === id);
      if (!trimmed || !existing || existing.name === trimmed) return;
      save(get().mixes.map((mix) => mix.id === id ? { ...mix, name: trimmed } : mix));
    },
    togglePin: (id) => {
      const mix = get().mixes.find((item) => item.id === id);
      if (!mix || (!mix.pinned && get().mixes.filter((item) => item.pinned).length >= PIN_LIMIT)) return;
      save(get().mixes.map((item) => item.id === id ? { ...item, pinned: !item.pinned } : item));
    },
    remove: (id) => {
      const removed = get().mixes.find((mix) => mix.id === id);
      if (removed) save(get().mixes.filter((mix) => mix.id !== id));
      return removed;
    },
    restore: (mix) => {
      const { mixes } = get();
      if (mixes.some((item) => item.id === mix.id) || mixes.length >= MIX_LIMIT) return false;
      const pinned = mix.pinned && mixes.filter((item) => item.pinned).length < PIN_LIMIT;
      save(retainMixes([...mixes, { ...mix, pinned }]));
      return true;
    },
  };
});

let initialization: Promise<void> | undefined;
export function initializeMixLibrary(): Promise<void> {
  return initialization ??= loadMixes(read(), (data) => librarySchema.parse(data) as SavedMix[], retainMixes)
    .then((mixes) => { useMixLibrary.setState({ mixes, ready: true, storageError: false }); })
    .catch((error) => { useMixLibrary.setState({ storageError: true, ready: false }); throw error; });
}
