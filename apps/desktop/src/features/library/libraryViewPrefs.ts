import { LIBRARY_PLAYLIST_SORTS, type LibraryPlaylistSort } from "./libraryPresentation";
import type { OwnerFilter } from "./LibraryToolbar";

export type LibraryView = "grid" | "list";

const SORT_KEY = "luftplayer.library.playlist-sort";
const VIEW_KEY = "luftplayer.library.view";
const OWNER_KEY = "luftplayer.library.owner";
const FOLDER_KEY = "luftplayer.library.folder";

export function readPlaylistSort(): LibraryPlaylistSort {
  const stored = read(SORT_KEY);
  return LIBRARY_PLAYLIST_SORTS.includes(stored as LibraryPlaylistSort)
    ? stored as LibraryPlaylistSort
    : "smart";
}

export function savePlaylistSort(sort: LibraryPlaylistSort): void {
  write(SORT_KEY, sort);
}

export function readLibraryView(): LibraryView {
  return read(VIEW_KEY) === "list" ? "list" : "grid";
}

export function saveLibraryView(view: LibraryView): void {
  write(VIEW_KEY, view);
}

export function readOwnerFilter(): OwnerFilter {
  const stored = read(OWNER_KEY);
  return stored === "mine" || stored === "followed" || stored === "spotify" ? stored : "all";
}

export function saveOwnerFilter(owner: OwnerFilter): void {
  write(OWNER_KEY, owner);
}

export function readFolderFilter(): string | undefined {
  return read(FOLDER_KEY) || undefined;
}

export function saveFolderFilter(folder: string | undefined): void {
  write(FOLDER_KEY, folder ?? "");
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A blocked storage backend must not affect the library.
  }
}
